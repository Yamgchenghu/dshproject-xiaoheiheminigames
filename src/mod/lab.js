/**
 * 模组实验室。
 *
 * 【这个功能到底是什么】它把一款小游戏"打开"给 Python 脚本：
 *   游戏启动的同一瞬间，脚本在独立的执行线程里跑起来，
 *   脚本里写 `minesweeper.bomb.density = 0.2` 就会立刻改掉这一局的雷密度。
 *
 * 【为什么必须明确标注"不计入排行榜"】
 *   模组可以任意改分数。如果允许带模组的对局上榜，榜单立刻失去意义，
 *   对其他玩家也不公平。所以带模组的对局在提交前就被拦下，
 *   界面上也会用醒目的标签提示。
 *
 * 【为什么入口藏得深】这不是给所有人用的功能：需要懂一点 Python，
 *   也需要理解"改了参数这局就不算数"。放在设置 → 连点版本号 之后，
 *   既能被需要的人找到，又不会让普通玩家误触。
 */
import { h } from '../core/util.js';
import { GAMES } from '../games/index.js';
import { toast } from './toast-helper.js';
import {
  loadMods, saveMod, allMods, budgetBanner, MOD_BUDGET, modUsage,
  isModDisabled, setModEnabled,
} from './store.js';
import { exportJson, importJson } from '../sdk/files.js';
import { VERSION } from '../version.js';

const EMOJI = { minesweeper: '💣', fruitninja: '🍉', g2048: '🔢', snake: '🐍' };

const TEMPLATES = {
  minesweeper: `# 扫雷模组示例
# 游戏启动瞬间执行；改完立刻生效
minesweeper.bomb.density = 0.3   # 雷密度降到 30%
minesweeper.lives = 3            # 可以踩 3 次

# timer 是一个类，可以加时
timer.add(60)

print("扫雷模组已加载")
`,
  fruitninja: `# 切水果模组示例
fruitninja.bomb.appearrate = 0.001   # 炸弹概率 0.1%
fruitninja.spawn.interval = 0.35     # 出果更快
fruitninja.fruit.scoreMul = 2        # 每个水果双倍分

import random
print("炸弹概率已设为", fruitninja.bomb.appearrate)
`,
  g2048: `# 2048 模组示例
g2048.spawn.fourChance = 0.5   # 一半概率生成 4
print("4 的出现概率：", g2048.spawn.fourChance)
`,
  snake: `# 贪吃蛇模组示例
snake.speed = 0.6              # 慢一点
snake.grow.perFood = 3         # 每个果实长 3 节
import time
time.sleep(2)
print("2 秒后提示：慢慢玩")
`,
};

export async function openModLab(state) {
  await loadMods();

  let gameId = GAMES[0].id;

  const header = h('div', { class: 'tool-header' }, [
    h('button', { class: 'hud-back', onclick: () => exit() }, '‹'),
    h('h1', {}, '模组实验室'),
    h('span', { class: 'badge warn' }, '不计入排行榜'),
  ]);

  const body = h('div', { class: 'page', style: { paddingTop: '10px' } });
  const screen = h('div', {
    style: {
      position: 'fixed', inset: '0', background: 'var(--bg)', zIndex: '70',
      display: 'flex', flexDirection: 'column',
    },
  }, [header, body]);
  document.body.appendChild(screen);

  const gameRow = h('div', { class: 'mode-row' });
  for (const g of GAMES) {
    gameRow.appendChild(h('button', {
      class: `mode-pill${g.id === gameId ? ' active' : ''}`,
      dataset: { id: g.id },
      onclick: () => {
        gameId = g.id;
        for (const el of gameRow.children) el.classList.toggle('active', el.dataset.id === gameId);
        renderEditor();
      },
    }, `${EMOJI[g.id] || ''} ${g.title}`));
  }

  const editorHost = h('div', {});
  body.appendChild(h('div', { class: 'section-title' }, '选择游戏'));
  body.appendChild(gameRow);
  body.appendChild(editorHost);

  body.appendChild(
    h('div', { class: 'card', style: { marginTop: '14px' } }, [
      h('h3', {}, '使用说明'),
      h('div', { class: 'hint', style: { lineHeight: '1.8' } }, [
        '1. 在上面的编辑器里写 Python，点「保存」。',
        h('br'),
        '2. 回到游戏页开一局，脚本会在游戏启动的同一瞬间执行。',
        h('br'),
        '3. 脚本对游戏对象的修改会立刻同步到正在运行的游戏。',
        h('br'),
        '4. 游戏结束时，脚本进程会被强制终止。',
        h('br'),
        h('span', { style: { color: 'var(--warn)' } }, '带模组的对局不计入排行榜，也不会刷新最佳成绩。'),
      ]),
    ]),
  );

  function renderEditor() {
    const meta = GAMES.find((g) => g.id === gameId);
    const current = allMods()[gameId] || '';
    editorHost.innerHTML = '';

    // 【为什么开关放在编辑器上方而不是塞进按钮行】它是"这个脚本现在生不生效"
    //   的状态，不是一次操作。放顶部、带明确的"已启用/已禁用"文字，
    //   玩家一眼就知道当前这局会不会跑脚本；混在一排按钮里容易被当成
    //   又一个动作按钮点掉。
    const hasScript = !!current.trim();
    const disabled = isModDisabled(gameId);
    const stateRow = h('div', {
      class: 'card',
      style: { marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' },
    }, [
      h('div', { style: { flex: '1 1 auto' } }, [
        h('div', { style: { fontWeight: '600' } }, disabled ? '已禁用' : '已启用'),
        h('div', { class: 'hint' }, hasScript
          ? (disabled
            ? '脚本已保存，但开游戏时不会执行'
            : '开游戏时会执行这份脚本')
          : '还没有保存脚本'),
      ]),
      h('button', {
        class: 'btn' + (disabled ? ' primary' : ''),
        disabled: hasScript ? undefined : 'disabled',
        onclick: async () => {
          const res = await setModEnabled(gameId, disabled);
          if (!res.ok) {
            toast(res.error === 'NO_SCRIPT' ? '这个游戏还没有脚本' : '切换失败：' + res.error);
            return;
          }
          toast(res.enabled ? '已启用，下次开游戏生效' : '已禁用，下次开游戏生效');
          renderEditor();
        },
      }, disabled ? '启用' : '禁用'),
    ]);
    editorHost.appendChild(stateRow);

    const area = h('textarea', {
      class: 'code-area',
      spellcheck: 'false',
      placeholder: `# 在这里写 Python\n${meta.id}.score = 0`,
    });
    area.value = current;

    // 预算条要跟着输入实时变，否则用户敲到一半超了也不知道
    // 用源码字节数，不是云端打包字节数：用户看到的 MOD_BUDGET 是源码上限
    let usedBytes = modUsage().used || 0;

    const budgetEl = h('div', { class: 'budget-line' }, '');
    function syncBudget() {
      const draft = usedBytes - utf8Len(current) + utf8Len(area.value);
      budgetEl.textContent = budgetBanner(Math.max(0, draft));
      budgetEl.classList.toggle('over', draft > MOD_BUDGET);
    }
    area.addEventListener('input', syncBudget);
    syncBudget();

    editorHost.appendChild(
      h('div', { class: 'card' }, [
        h('div', { class: 'row' }, [
          h('div', {}, [
            h('div', { class: 'label' }, `${meta.title} 的模组脚本`),
            h('div', { class: 'hint' }, current ? '已启用' : '未启用（保存后生效）'),
          ]),
          current ? h('span', { class: 'badge warn' }, '已启用') : h('span', { class: 'badge' }, '未启用'),
        ]),
        area,
        budgetEl,
        h('div', { class: 'btn-row', style: { marginTop: '10px' } }, [
          h('button', {
            class: 'btn primary',
            onclick: async () => {
              const res = await saveMod(gameId, area.value);
              if (!res.ok) {
                toast(res.error === 'OVER_BUDGET'
                  ? `超出配额：${res.usage}/${MOD_BUDGET} 字节`
                  : '保存失败：' + res.error);
                return;
              }
              usedBytes = res.usage;
              toast(area.value.trim() ? '已保存，下次开游戏生效' : '已清除');
              renderEditor();
            },
          }, '保存'),
          h('button', {
            class: 'btn',
            onclick: async () => {
              await saveMod(gameId, '');
              renderEditor();
              toast('已清除');
            },
          }, '清除'),
          h('button', {
            class: 'btn',
            onclick: () => {
              area.value = TEMPLATES[gameId] || '';
            },
          }, '填入示例'),
          h('button', {
            class: 'btn',
            onclick: async () => {
              const res = await exportJson(`模组-${gameId}.json`, {
                app: 'mini-games-tools',
                version: VERSION,
                gameId,
                code: area.value,
              });
              if (res.ok) toast('已导出');
            },
          }, '导出'),
          h('button', {
            class: 'btn',
            onclick: async () => {
              const res = await importJson(['.json', '.py', '.txt']);
              if (res.cancelled) return;
              if (!res.ok) return toast('导入失败：' + res.error);
              const data = res.data;
              if (typeof data === 'string') area.value = data;
              else if (data && typeof data.code === 'string') area.value = data.code;
              else return toast('文件里没有脚本内容');
              toast('已载入到编辑器，记得点保存');
            },
          }, '导入'),
        ]),
      ]),
    );

    // 参数手册
    editorHost.appendChild(renderSchemaDoc(meta));
  }

  /** 参数手册：从游戏 meta.schema 自动生成，保证文档和代码不会脱节 */
  function renderSchemaDoc(meta) {
    const rows = [];
    const walk = (obj, prefix) => {
      for (const [k, v] of Object.entries(obj || {})) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          walk(v, path);
        } else {
          const type = Array.isArray(v) ? 'list' : v === null ? 'any' : typeof v;
          rows.push({ path: `${meta.id}.${path}`, type, def: JSON.stringify(v) });
        }
      }
    };
    walk(meta.schema, '');

    const table = h('div', {});
    for (const r of rows) {
      table.appendChild(
        h('div', { class: 'record-row', style: { padding: '9px 12px' } }, [
          h('div', { class: 'rr-main' }, [
            h('div', { class: 'rr-name mono', style: { fontSize: '12px' } }, r.path),
            h('div', { class: 'rr-sub' }, `${r.type} · 默认 ${r.def}`),
          ]),
        ]),
      );
    }

    const box = h('div', { class: 'card', style: { marginTop: '10px' } }, [
      h('h3', {}, '可改参数（自动生成）'),
      h('div', { class: 'hint', style: { marginBottom: '8px' } },
        '下面是这款游戏当前暴露给 Python 的全部参数。直接赋值即可改，改完立刻生效。'),
      table,
      meta.classes?.timer
        ? h('div', { class: 'hint', style: { marginTop: '10px', lineHeight: '1.75' } }, [
            h('b', {}, 'timer 类：'),
            h('br'),
            `属性：${meta.classes.timer.attrs.join(' / ')}`,
            h('br'),
            `方法：${meta.classes.timer.methods.join(' / ')}`,
            h('br'),
            '例：timer.add(30) 加 30 秒；timer.remaining 读取剩余秒数。',
          ])
        : null,
    ]);
    return box;
  }

  function exit() {
    screen.remove();
  }

  /** 和 core/pack.js 的 utf8Length 同义，这里内联避免多一层依赖 */
  function utf8Len(str) {
    let n = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  renderEditor();
  return { destroy: exit };
}
