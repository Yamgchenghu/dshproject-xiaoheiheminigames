/**
 * 单词机 —— 主界面。
 *
 * 【这个页面做什么】把 Android 版「单词机」的核心学习闭环搬到小程序里：
 *   看词 → 学 → 考（敲英文）→ 判分 → 错词重考。
 *   课文那条线同理：看句 → 学 → 背（敲英文）→ 判分。
 *
 * 【为什么不用原版 app.js 直接搬】原版是 219 KB 的单文件，
 *   里面混了 Android 桥（Wg.request / Wg.speak / Wg.pickFile）、
 *   服务器同步、AI 调用、音色克隆上传……
 *   小程序这边这些桥一个都没有，而且 CSP 也不允许运行时联网。
 *   直接搬进来 90% 的代码是死代码，还会因为调用不存在的 Wg 而报错。
 *   所以这里只重写「离线也能跑」的那部分，把 AI/TTS 留成接口，
 *   等联网权限批下来再接。
 *
 * 【判分口径】一律走 logic.js，和原版服务端逐字符一致，
 *   避免「学习时敲对了、考试判错」这种最伤人的 bug。
 */
import { h } from '../../core/util.js';
import { toast } from '../../ui/toast.js';
import { openGlobalSettings } from '../../ui/global.js';
import L from './logic.js';
import OFFLINE from './offline-levels.js';
import {
  loadRecordSave, saveRecordSave,
  loadListSave, saveListSave,
  loadTextSave, saveTextSave,
  measureRecordSave, measureListSave, measureTextSave,
  LIST_MAX, TEXT_MAX, LIST_BYTES, TEXT_BYTES, RECORD_BYTES,
} from './save-bridge.js';
import { fmtBytes } from '../../core/save.js';
import { speakSmart } from '../wheel/voice.js';
// 【这几个必须显式导入】之前漏了，代码里直接调用 aiParseWords / aiParseImage /
//   aiSummarizeText，运行时会在这些分支抛 ReferenceError——
//   表现是「点 AI 整理没反应」或「点了报错」，但构建完全不报错，
//   因为打包器只检查语法不检查自由变量。
import {
  aiParseWords, aiParseImage, aiSummarizeText, aiSplitGroups, aiReady,
} from '../../core/ai.js';

/**
 * 朗读一个词/一句课文。
 * 【为什么优先走转盘那套预生成音色】转盘已经内置了 113 条常用短语的
 *   预生成音频和系统语音兜底，复用它比自己再造一套省得多，
 *   而且音色和转盘保持一致。命中不了就退回系统语音。
 */
async function speakText(text) {
  if (!text) return;
  try {
    await speakSmart(text, { voice: 'langdu', lang: 'en-US' });
  } catch { /* 朗读失败不影响学习 */ }
}

/** 一组多少词。和原版一致：10 个一组，满分组和重考组都按这个切。 */
const GROUP_SIZE = 10;

/** 词表来源：离线包里的三玖关 + 用户自定义 */
function levelFromOffline() {
  const w = OFFLINE && OFFLINE.word;
  if (!w || !Array.isArray(w.words)) return null;
  return {
    num: w.num,
    name: w.name || String(w.num),
    words: w.words.map((x) => ({ en: String(x.en || ''), zh: String(x.zh || '') }))
      .filter((x) => x.en),
  };
}

function textFromOffline() {
  const t = OFFLINE && OFFLINE.text;
  if (!t || !Array.isArray(t.sentences)) return null;
  return {
    num: t.num,
    name: t.name || String(t.num),
    sentences: t.sentences.map((x) => ({ en: String(x.en || ''), zh: String(x.zh || '') }))
      .filter((x) => x.en),
  };
}

export async function openWordGameScreen({ onExit }) {
  const header = h('div', { class: 'tool-header' }, [
    h('button', { class: 'hud-back', onclick: () => exit() }, '‹'),
    h('h1', {}, '单词机'),
    // 全屏页盖住了外壳顶栏，设置入口必须在这里补
    h('button', { class: 'icon-btn', title: '设置', onclick: () => openGlobalSettings() }, '⚙'),
  ]);

  const body = h('div', { class: 'page', style: { paddingTop: '10px' } });
  const screen = h('div', {
    style: {
      position: 'fixed', inset: '0', background: 'var(--bg)', zIndex: '60',
      display: 'flex', flexDirection: 'column',
    },
  }, [header, body]);
  document.body.appendChild(screen);

  body.appendChild(h('div', { class: 'empty' }, '正在读取存档…'));

  let recordSave = null;  // 学习记录：生词本 + 关卡进度 + 背诵进度
  let listSave = null;    // 词表正文：用户自建词表
  let textSave = null;    // 课文正文
  // 当前选中的课文 id（空表示用离线内置那篇）。
  // 【为什么不直接存下标】删除课文后下标会错位，指向别的课文。
  //   存 id 就不受顺序变化影响。
  let curTextId = '';
  try {
    [recordSave, listSave, textSave] = await Promise.all([
      loadRecordSave(), loadListSave(), loadTextSave(),
    ]);
  } catch {
    recordSave = null; listSave = null; textSave = null;
  }

  function exit() {
    screen.remove();
    if (onExit) onExit();
  }

  /* ---------------- 首页 ---------------- */

  function renderHome() {
    body.innerHTML = '';

    const lv = levelFromOffline();
    // 【课文来源优先级】用户导入的 > 离线内置。
    //   一旦用户导入过课文，就不该再被内置那篇顶掉。
    let tx = null;
    if (curTextId) {
      const one = textSave.texts.find((x) => x.id === curTextId);
      if (one) {
        tx = { num: one.id, name: one.name, sentences: one.sentences };
      }
    }
    if (!tx && textSave.texts.length) {
      // 没有明确选中就用第一份导入的
      const one = textSave.texts[0];
      curTextId = one.id;
      tx = { num: one.id, name: one.name, sentences: one.sentences };
    }
    if (!tx) tx = textFromOffline();

    // ---- 单词 ----
    body.appendChild(h('div', { class: 'section-title' }, '背单词'));
    const wcard = h('div', { class: 'tool-card', style: { '--hero-accent': '#4ad991', flexDirection: 'column', alignItems: 'stretch', gap: '10px' } });

    if (lv) {
      // 【为什么按本关算而不是按 vocab 总数】vocab 是全库生词本，
      //   里面混着别的关、自定义词表的词。用它当「本关已掌握」
      //   会显示成「43 个词 · 已掌握 87 个」，比词还多。
      const lvSave = recordSave.levels[lv.num] || {};
      const completedSet = new Set(lvSave.completed || []);
      const learned = lv.words.filter((w) => completedSet.has(L.wordId(w.en))).length;
      const done = !!lvSave.done;
      wcard.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
        h('div', { class: 'tool-art', style: { background: '#4ad9911f', borderColor: '#4ad99144' } }, '📖'),
        h('div', { style: { flex: '1', textAlign: 'left' } }, [
          h('h3', {}, '第 ' + lv.num + ' 关'),
          h('p', {}, lv.words.length + ' 个词 · 已掌握 ' + learned + ' 个' + (done ? ' · 已通关' : '')),
        ]),
      ]));
      wcard.appendChild(h('button', {
        class: 'hud-btn',
        style: { width: '100%', padding: '11px' },
        onclick: () => startWordLearn(lv),
      }, done ? '再学一遍' : '开始学习'));
    } else {
      wcard.appendChild(h('div', { class: 'empty' }, '没有可用的离线词表'));
    }
    body.appendChild(wcard);

    // ---- 自定义词表 ----
    body.appendChild(h('div', { class: 'section-title', style: { marginTop: '18px' } }, '我的词表'));
    const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
    if (!listSave.custom.length) {
      list.appendChild(h('div', { class: 'empty', style: { padding: '14px' } }, '还没有自定义词表'));
    }
    for (const c of listSave.custom) {
      list.appendChild(h('button', {
        class: 'tool-card',
        style: { padding: '12px 14px' },
        onclick: () => startWordLearn({ num: c.id, name: c.name, words: c.words }),
      }, [
        h('div', { style: { flex: '1', textAlign: 'left' } }, [
          h('h3', {}, c.name),
          h('p', {}, c.words.length + ' 个词'),
        ]),
        h('div', { class: 'chev' }, '›'),
      ]));
    }
    list.appendChild(h('button', {
      class: 'hud-btn',
      style: { marginTop: '4px' },
      onclick: () => openImportWordlist(),
    }, '＋ 导入词表'));
    body.appendChild(list);

    // ---- 课文 ----
    body.appendChild(h('div', { class: 'section-title', style: { marginTop: '18px' } }, '背课文'));
    const tcard = h('div', { class: 'tool-card', style: { '--hero-accent': '#6ea8ff', flexDirection: 'column', alignItems: 'stretch', gap: '10px' } });
    if (tx) {
      const doneCount = (textSave.texts.find((t) => String(t.id) === String(tx.num)) || {}).completed || [];
      tcard.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
        h('div', { class: 'tool-art', style: { background: '#6ea8ff1f', borderColor: '#6ea8ff44' } }, '📜'),
        h('div', { style: { flex: '1', textAlign: 'left' } }, [
          h('h3', {}, '第 ' + tx.num + ' 篇'),
          h('p', {}, tx.sentences.length + ' 句 · 已背 ' + doneCount.length + ' 句'),
        ]),
      ]));
      tcard.appendChild(h('div', { style: { display: 'flex', gap: '8px' } }, [
        h('button', {
          class: 'hud-btn',
          style: { flex: '1', padding: '11px' },
          onclick: () => startTextLearn(tx),
        }, '开始背诵'),
        h('button', {
          class: 'hud-btn',
          style: { flex: '1', padding: '11px' },
          onclick: () => openTextAiNotes(tx),
        }, 'AI 怎么背'),
      ]));
    } else {
      tcard.appendChild(h('div', { class: 'empty' }, '没有可用的离线课文'));
    }
    body.appendChild(tcard);
    body.appendChild(h('button', {
      class: 'hud-btn',
      style: { marginTop: '4px' },
      onclick: () => openImportText(),
    }, '＋ 导入课文'));

    // 已导入的课文列表（最多 TEXT_MAX 篇），点一下切换当前课文
    if (textSave.texts.length) {
      const tlist = h('div', { class: 'list-card', style: { marginTop: '10px' } });
      for (const one of textSave.texts) {
        const isCur = tx && String(one.id) === String(tx.num);
        tlist.appendChild(h('div', {
          class: 'list-row' + (isCur ? ' on' : ''),
          style: { cursor: 'pointer' },
          onclick: () => {
            // 切到这篇：把 id 存进 curNum 语义的位置，然后重渲染
            curTextId = one.id;
            renderHome();
          },
        }, [
          h('div', { style: { flex: '1', textAlign: 'left' } }, [
            h('div', {}, one.name),
            h('div', { class: 'empty', style: { padding: '2px 0', fontSize: '11px' } },
              one.sentences.length + ' 句 · 已背 ' + (one.completed || []).length + ' 句'),
          ]),
          h('button', {
            class: 'hud-btn',
            style: { padding: '6px 10px', fontSize: '12px' },
            onclick: (ev) => {
              ev.stopPropagation();
              textSave.texts = textSave.texts.filter((x) => x.id !== one.id);
              saveTextSave(textSave).then((r) => {
                if (!r.ok) toast('删除失败：' + (r.error || '未知'));
                else { toast('已删除'); renderHome(); }
              });
            },
          }, '删除'),
        ]));
      }
      body.appendChild(tlist);
    }

    // ---- 存档占用 ----
    body.appendChild(h('div', {
      class: 'empty',
      style: { padding: '18px 4px', fontSize: '12px', textAlign: 'left', lineHeight: '1.7' },
    }, [
      h('div', {}, '词表：' + fmtBytes(measureListSave(listSave)) + ' / ' + fmtBytes(LIST_BYTES)
        + '（' + listSave.custom.length + '/' + LIST_MAX + ' 份）'),
      h('div', {}, '课文：' + fmtBytes(measureTextSave(textSave)) + ' / ' + fmtBytes(TEXT_BYTES)
        + '（' + textSave.texts.length + '/' + TEXT_MAX + ' 篇）'),
      h('div', {}, '学习记录：' + fmtBytes(measureRecordSave(recordSave)) + ' / ' + fmtBytes(RECORD_BYTES)),
    ]));
  }

  /* ---------------- 导入词表 ---------------- */

  function openImportWordlist() {
    // 解析结果先放这里，点「导入」时才真正写存档。
    // 【为什么不在 AI 返回时直接存】模型可能识别出乱七八糟的东西，
    //   让用户先看一眼条数和前几个词，确认没问题再存，比存进去再删好。
    let parsed = [];

    const ta = h('textarea', {
      placeholder: '每行一个词，英文和中文用 Tab 或空格隔开\n例如：\napple\t苹果\nbanana 香蕉\n\n也可以直接粘贴整段课文或带音标、词性的原文，交给 AI 整理',
      style: {
        width: '100%', minHeight: '150px', padding: '12px', borderRadius: '12px',
        background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--text)',
        fontSize: '14px', lineHeight: '1.6', resize: 'vertical', fontFamily: 'inherit',
        boxSizing: 'border-box',
      },
    });
    const nameIn = h('input', {
      placeholder: '词表名字（可留空）',
      style: {
        width: '100%', padding: '11px 12px', borderRadius: '12px',
        background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--text)',
        fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box',
      },
    });

    // 预览区：AI 或本地解析出结果后显示条数和样例
    const preview = h('div', {
      style: {
        fontSize: '12px', color: 'var(--muted)', lineHeight: '1.7',
        minHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      },
    }, '');

    // 隐藏的图片选择器
    const fileIn = h('input', {
      type: 'file', accept: 'image/*',
      style: { display: 'none' },
    });

    const aiBtn = h('button', {
      class: 'hud-btn',
      style: { flex: '1', padding: '10px', fontSize: '13px' },
      onclick: async () => {
        const raw = (ta.value || '').trim();
        if (!raw) { toast('先粘贴一段文字'); return; }
        aiBtn.disabled = true;
        const old = aiBtn.textContent;
        aiBtn.textContent = 'AI 整理中…';
        preview.textContent = '正在让 AI 提取单词，请稍等…';
        try {
          parsed = await aiParseWords(raw);
          preview.textContent = '识别到 ' + parsed.length + ' 个词：\n' +
            parsed.slice(0, 6).map((w) => w.en + '  ' + w.zh).join('\n') +
            (parsed.length > 6 ? '\n…' : '');
          toast('AI 识别到 ' + parsed.length + ' 个词', 'good');
        } catch (e) {
          parsed = [];
          preview.textContent = '';
          toast('AI 整理失败：' + ((e && e.message) || '未知原因'));
        } finally {
          aiBtn.disabled = false;
          aiBtn.textContent = old;
        }
      },
    }, 'AI 整理');

    const imgBtn = h('button', {
      class: 'hud-btn',
      style: { flex: '1', padding: '10px', fontSize: '13px' },
      onclick: () => fileIn.click(),
    }, '拍照识图');

    fileIn.addEventListener('change', async () => {
      const file = fileIn.files && fileIn.files[0];
      if (!file) return;
      const old = imgBtn.textContent;
      imgBtn.disabled = true;
      imgBtn.textContent = '识图中…';
      preview.textContent = '正在识别图片里的单词，大图可能要十几秒…';
      try {
        const dataUrl = await fileToDataUrl(file);
        parsed = await aiParseImage(dataUrl);
        preview.textContent = '识别到 ' + parsed.length + ' 个词：\n' +
          parsed.slice(0, 6).map((w) => w.en + '  ' + w.zh).join('\n') +
          (parsed.length > 6 ? '\n…' : '');
        toast('识别到 ' + parsed.length + ' 个词', 'good');
      } catch (e) {
        parsed = [];
        preview.textContent = '';
        toast('识图失败：' + ((e && e.message) || '未知原因'));
      } finally {
        imgBtn.disabled = false;
        imgBtn.textContent = old;
        fileIn.value = '';
      }
    });

    const sheet = modal('导入词表', [
      nameIn,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '2px' } }, [aiBtn, imgBtn]),
      ta,
      fileIn,
      preview,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '4px' } }, [
        h('button', { class: 'hud-btn', style: { flex: '1', padding: '11px' }, onclick: () => sheet.close() }, '取消'),
        h('button', {
          class: 'hud-btn',
          style: { flex: '1', padding: '11px', background: 'var(--accent)', color: '#08120c', fontWeight: '700' },
          onclick: async () => {
            // AI 已经解析过就用它的结果；否则按用户手打的格式本地解析。
            // 这样「AI 整理完又改了文本框」时不会用旧结果。
            const list = parsed.length ? parsed : L.parseLevelText(ta.value || '');
            if (!list.length) { toast('没解析出词，检查一下格式'); return; }
            // 【为什么在写入前就拦】词表是几十 KB 的大对象，
            //   写满之后 saveListSave 会因为超出块容量失败，
            //   但那时用户的词已经输入完了，白费功夫。先拦能省事。
            if (listSave.custom.length >= LIST_MAX) {
              toast(`最多 ${LIST_MAX} 份词表，先删一份再导入`);
              return;
            }
            const name = (nameIn.value || '').trim() || ('词表 ' + (listSave.custom.length + 1));
            const id = L.uid('c');
            const nextCustom = listSave.custom.concat([{
              id, name,
              words: list.map((x) => ({ en: x.en, zh: x.zh })),
              createdAt: Date.now(), updatedAt: Date.now(),
            }]);
            // 先试算字节数，超了就不落盘
            const probe = { ...listSave, custom: nextCustom };
            if (measureListSave(probe) > LIST_BYTES) {
              toast(`词表总计超过 ${fmtBytes(LIST_BYTES)}，这份太大存不下`);
              return;
            }
            listSave.custom = nextCustom;
            const r = await saveListSave(listSave);
            sheet.close();
            if (!r.ok) { toast('存档写入失败：' + (r.error || '未知')); return; }
            toast('已导入 ' + list.length + ' 个词', 'good');
            renderHome();
          },
        }, '导入'),
      ]),
    ]);
  }

  /* ---------------- 导入课文 ---------------- */

  /**
   * 导入一篇课文。
   *
   * 【为什么复用词表那套解析】课文的本质是「一串句子」，
   *   而 parseTextLevel 已经能处理三种常见形态：
   *     ① 每行 en<TAB>zh —— 最规整，粘贴 Excel 两列就是这个
   *     ② 每行只有英文 —— 当句子逐行读
   *     ③ 整段散文 —— 自动切句并按中英文比例配对
   *   再写一套解析只会多一份不一致的规则。
   *
   * 【为什么要给 AI 整理】用户从网上复制的课文经常带音标、
   *   行号、页码、中文注释混排，本地解析会切得很碎。
   *   AI 能按句子重排并补译文，这一步是「可选」的，不点也能导入。
   */
  function openImportText() {
    if (textSave.texts.length >= TEXT_MAX) {
      toast(`最多 ${TEXT_MAX} 篇课文，先在列表里删一篇`);
      return;
    }

    const nameIn = h('input', {
      class: 'inp',
      placeholder: '课文名字，例如 Unit 3 Reading',
      maxlength: '40',
    });
    const ta = h('textarea', {
      class: 'inp',
      rows: '7',
      placeholder: '粘贴课文原文。\n\n推荐格式（每行一句，英文和中文用 Tab 隔开）：\nI have a dream.\t我有一个梦想。\n\n也可以直接粘贴整段英文，会自动切句',
      style: { resize: 'vertical', lineHeight: '1.6' },
    });
    const preview = h('div', { class: 'empty', style: { padding: '6px 0', fontSize: '12px' } }, '');
    let parsed = [];

    const fileIn = h('input', { type: 'file', accept: '.txt,.md,text/plain', style: { display: 'none' } });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files && fileIn.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        ta.value = text;
        parsed = [];
        preview.textContent = '已读取 ' + fmtBytes(new TextEncoder().encode(text).length);
      } catch (e) {
        toast('读取失败：' + ((e && e.message) || '未知'));
      } finally {
        fileIn.value = '';
      }
    });

    const fileBtn = h('button', {
      class: 'hud-btn',
      style: { flex: '1', padding: '9px', fontSize: '13px' },
      onclick: () => fileIn.click(),
    }, '选 txt 文件');

    const parseBtn = h('button', {
      class: 'hud-btn',
      style: { flex: '1', padding: '9px', fontSize: '13px' },
      onclick: () => {
        parsed = L.parseTextLevel(ta.value || '');
        preview.textContent = parsed.length
          ? `解析出 ${parsed.length} 句`
          : '没解析出句子，检查一下内容';
      },
    }, '本地切句');

    const aiBtn = h('button', {
      class: 'hud-btn',
      style: { flex: '1', padding: '9px', fontSize: '13px' },
      onclick: async () => {
        const raw = (ta.value || '').trim();
        if (!raw) { toast('先把课文贴进来'); return; }
        const old = aiBtn.textContent;
        aiBtn.disabled = true;
        aiBtn.textContent = 'AI 切句中…';
        try {
          // 复用词表的 AI 整理：它返回 [{en, zh}]，
          // 对课文来说就是「一句一行」，语义一致
          parsed = await aiParseWords(raw, { asSentences: true });
          preview.textContent = parsed.length
            ? `AI 切出 ${parsed.length} 句`
            : 'AI 没切出句子';
          if (parsed.length) toast('识别到 ' + parsed.length + ' 句', 'good');
        } catch (e) {
          parsed = [];
          preview.textContent = '';
          toast('AI 失败：' + ((e && e.message) || '未知原因'));
        } finally {
          aiBtn.disabled = false;
          aiBtn.textContent = old;
        }
      },
    }, 'AI 切句');

    const sheet = modal('导入课文', [
      nameIn,
      ta,
      fileIn,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '2px' } }, [fileBtn, parseBtn, aiBtn]),
      preview,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '4px' } }, [
        h('button', { class: 'hud-btn', style: { flex: '1', padding: '11px' }, onclick: () => sheet.close() }, '取消'),
        h('button', {
          class: 'hud-btn',
          style: { flex: '1', padding: '11px', background: 'var(--accent)', color: '#08120c', fontWeight: '700' },
          onclick: async () => {
            const list = parsed.length ? parsed : L.parseTextLevel(ta.value || '');
            if (!list.length) { toast('没解析出句子，检查一下内容'); return; }
            if (textSave.texts.length >= TEXT_MAX) {
              toast(`最多 ${TEXT_MAX} 篇课文，先删一篇再导入`);
              return;
            }
            const name = (nameIn.value || '').trim() || ('课文 ' + (textSave.texts.length + 1));
            const id = L.uid('t');
            const nextTexts = textSave.texts.concat([{
              id, name,
              sentences: list.map((x) => ({ en: x.en, zh: x.zh })),
              completed: [], createdAt: Date.now(), updatedAt: Date.now(),
              aiNotes: null, aiVersion: '',
            }]);
            const probe = { ...textSave, texts: nextTexts };
            if (measureTextSave(probe) > TEXT_BYTES) {
              toast(`课文总计超过 ${fmtBytes(TEXT_BYTES)}，这篇太长存不下`);
              return;
            }
            textSave.texts = nextTexts;
            const r = await saveTextSave(textSave);
            sheet.close();
            if (!r.ok) { toast('存档写入失败：' + (r.error || '未知')); return; }
            curTextId = id;
            toast('已导入 ' + list.length + ' 句', 'good');
            renderHome();
          },
        }, '导入'),
      ]),
    ]);
  }

  /* ---------------- 弹层 ---------------- */

  function modal(title, children) {
    const box = h('div', {
      style: {
        position: 'fixed', inset: '0', zIndex: '80', background: 'rgba(0,0,0,.6)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      },
    });
    const card = h('div', {
      style: {
        width: '100%', maxWidth: '560px', maxHeight: '86vh', overflowY: 'auto',
        background: 'var(--bg-2)', borderTopLeftRadius: '18px', borderTopRightRadius: '18px',
        padding: '16px 16px calc(16px + var(--safe-bottom, 0px))',
        display: 'flex', flexDirection: 'column', gap: '10px',
      },
    }, [
      h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '2px' } }, [
        h('h2', { style: { margin: '0', fontSize: '16px', flex: '1' } }, title),
        h('button', { class: 'icon-btn', onclick: () => api.close() }, '✕'),
      ]),
      ...children,
    ]);
    box.appendChild(card);
    box.addEventListener('click', (e) => { if (e.target === box) api.close(); });
    document.body.appendChild(box);
    const api = {
      close() { box.remove(); },
      el: card,
    };
    return api;
  }

  /* ---------------- 学习 / 考试 ---------------- */

  /**
   * 一轮学习的完整流程：按 10 个一组，逐组「学 → 考 → 结算」。
   * 单词和课文共用这套骨架，差别只在「一个条目是什么」和「怎么判对」。
   *
   * 【为什么要分组】原版就是 10 个一组。43 个词一口气背完再考，
   *   中间学的东西早忘光了，考试等于重新猜一遍；
   *   而且一次要敲 43 个词，手机上是很长的折磨，中途退出就前功尽弃。
   *   切成 10 个一组，每组是一个独立的小闭环，随时可以停。
   *
   * 【为什么组内顺序要打乱两次】学习顺序和考试顺序分别打乱，
   *   且保证都不是原始顺序（L.studyOrderOf 会重试到不等于原序为止）。
   *   否则用户会连位置一起记，考试靠"第 3 个是 xxx"蒙对。
   */
  function runSession({ title, items: allItems, isCorrectFn, hintFn, onFinish, onGroupDone }) {
    // 全部词切成 10 个一组。
    //
    // 【为什么按原顺序切，不先整体打乱】分组必须稳定。
    //   如果每次进来都重新随机分，用户今天学了第 1 组的 8 个词，
    //   明天再进来这 8 个词散落到别的组里，"已掌握 8 / 43"就对不上了，
    //   而且永远不知道自己还剩哪几个没学。
    //   固定切法（第 1-10 个、第 11-20 个…）让"第 3 组"永远指同一批词。
    //
    // 【为什么组内还要打乱】组内顺序打乱是为了防止靠位置记忆，
    //   但成员不变，所以进度依然可追踪。学习和考试用两次不同的打乱
    //   （见 renderLearn 里的 studyOrderOf 和 startExam）。
    // 【为什么 let 而不是 const】用户随时可以点「AI 智能分组」把分组重排，
    //   重排后 groups 整个换掉，进度 gi 归零。
    let groups = [];
    for (let i = 0; i < allItems.length; i += GROUP_SIZE) {
      groups.push(allItems.slice(i, i + GROUP_SIZE));
    }
    let gi = 0;
    // 当前组（学习/考试都作用于它）
    let items = groups[0] || [];
    // 累计的答案表：跨组汇总，结算时一次性交给调用方
    const allAnswers = {};
    const screen2 = h('div', {
      style: {
        position: 'fixed', inset: '0', background: 'var(--bg)', zIndex: '70',
        display: 'flex', flexDirection: 'column',
      },
    });
    const head = h('div', { class: 'tool-header' }, [
      h('button', { class: 'hud-back', onclick: () => { screen2.remove(); renderHome(); } }, '‹'),
      h('h1', {}, title),
    ]);
    const main = h('div', { class: 'page', style: { paddingTop: '12px', flex: '1', overflowY: 'auto' } });
    screen2.appendChild(head);
    screen2.appendChild(main);
    document.body.appendChild(screen2);

    // ---- 阶段一：照抄（学） ----
    //
    // 【为什么是"抄"而不是"看"】原版这里就是照着敲一遍，敲对才能继续。
    //   只看一眼就过，等于没学——大脑对"认得"和"写得出"的区分很严格，
    //   看的时候觉得会了，考的时候照样写不出。
    //   强制手打一遍，是把"再认"转成"回忆"的最小代价做法。
    //
    // 【为什么学习顺序和考试顺序不同】用 L.studyOrderOf 打乱，
    //   并且保证不是原顺序。否则用户会连位置一起记住，
    //   考试时靠"第 3 个是 xxx"蒙对，而不是真的记住了词。
    let studyAt = 0;
    let studyTyped = '';
    let studyMiss = false;
    // 学习顺序：组内打乱，但保证不等于原始顺序。
    // 每次进组重新算一次，所以同一组反复练时顺序也会变，
    // 但成员固定，进度不会错位。
    let studySeq = L.studyOrderOf(items.length);
    const studyItem = (i) => items[studySeq[i]];

    function renderLearn() {
      main.innerHTML = '';
      if (studyAt >= items.length) { startExam(); return; }
      const it = studyItem(studyAt);

      main.appendChild(h('div', {
        style: { display: 'flex', alignItems: 'center', marginBottom: '10px' },
      }, [
        h('div', { style: { fontSize: '12px', color: 'var(--text-3)', flex: '1' } },
          '学习 ' + (studyAt + 1) + ' / ' + items.length),
        h('button', {
          class: 'hud-btn',
          style: { fontSize: '11px', padding: '5px 9px' },
          onclick: () => { studyAt = items.length; renderLearn(); },
        }, '跳过学习，直接考'),
      ]));

      // 待抄的内容
      main.appendChild(h('div', {
        style: {
          background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: '16px',
          padding: '22px 18px', textAlign: 'center', marginBottom: '12px',
        },
      }, [
        h('div', {
          style: {
            fontSize: '26px', fontWeight: '800', lineHeight: '1.35',
            wordBreak: 'break-word', letterSpacing: '0.2px',
          },
        }, it.en),
        it.zh ? h('div', { style: { marginTop: '9px', fontSize: '15px', color: 'var(--text-2)' } }, it.zh)
              : h('div', { style: { marginTop: '9px', fontSize: '13px', color: 'var(--text-3)' } }, '（缺中文释义）'),
        h('div', { style: { marginTop: '12px', display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center' } }, [
          h('button', {
            class: 'hud-btn',
            style: { fontSize: '12px', padding: '6px 12px' },
            onclick: () => speakText(it.en),
          }, '🔊 朗读'),
          h('span', { style: { fontSize: '11px', color: 'var(--text-3)' } },
            '单词数 ' + L.countWords(it.en) + ' / 字母数 ' + L.countChars(it.en)),
        ]),
      ]));

      // 抄写输入
      const input = h('input', {
        placeholder: '照着上面敲一遍，敲对才能继续',
        autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
        style: {
          width: '100%', padding: '13px 14px', borderRadius: '12px', boxSizing: 'border-box',
          background: 'var(--bg-3)',
          border: '1px solid ' + (studyMiss ? 'var(--danger, #ff5c5c)' : 'var(--line)'),
          color: 'var(--text)', fontSize: '17px', fontFamily: 'inherit',
        },
      });
      input.value = studyTyped;
      main.appendChild(input);
      setTimeout(() => input.focus(), 60);

      if (studyMiss) {
        main.appendChild(h('div', {
          style: { marginTop: '10px', fontSize: '13px', color: 'var(--danger, #ff5c5c)' },
        }, '敲错了，再对着上面看一遍'));
      }

      const submit = () => {
        const val = input.value;
        if (!val.trim()) return;
        if (isCorrectFn(val, it)) {
          studyAt++;
          studyTyped = '';
          studyMiss = false;
          renderLearn();
        } else {
          studyTyped = val;
          studyMiss = true;
          renderLearn();
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
      input.addEventListener('input', () => { studyTyped = input.value; });

      main.appendChild(h('button', {
        class: 'hud-btn',
        style: {
          width: '100%', padding: '13px', marginTop: '12px',
          background: 'var(--accent)', color: '#08120c', fontWeight: '700',
        },
        onclick: submit,
      }, studyAt + 1 >= items.length ? '学完了，开始考这组' : '敲对了，下一个'));
    }

    // ---- 阶段二：考试 ----
    let answers = {};
    let cur = 0;
    let tried = 0;

    function startExam() {
      answers = {};
      cur = 0;
      tried = 0;
      // 考试顺序再打乱一次，和学习顺序不同，防止靠"刚才是第几个"蒙。
      items = L.shuffle(items);
      renderExam();
    }

    /** 把当前组的答案并入总表，供跨组结算使用 */
    function mergeAnswers() {
      for (const [wid, a] of Object.entries(answers)) {
        const prev = allAnswers[wid];
        // 同一词可能在多组出现（重考），保留最好的成绩
        if (!prev || (a.correctAt && !prev.correctAt)) allAnswers[wid] = a;
      }
    }

    function renderExam() {
      main.innerHTML = '';
      if (cur >= items.length) { finish(); return; }
      const it = items[cur];
      const wid = L.wordId(it.en);
      const prev = answers[wid];

      main.appendChild(h('div', {
        style: { fontSize: '12px', color: 'var(--text-3)', marginBottom: '6px' },
      }, '考试 ' + (cur + 1) + ' / ' + items.length));

      main.appendChild(h('div', {
        style: {
          background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: '16px',
          padding: '22px 18px', textAlign: 'center', marginBottom: '14px',
        },
      }, [
        h('div', { style: { fontSize: '14px', color: 'var(--text-2)', marginBottom: '8px' } }, it.zh || '请写出英文'),
        // 第一次答错后给提示
        prev && prev.hint ? h('div', {
          style: { fontSize: '13px', color: 'var(--warn)', marginBottom: '6px' },
        }, '提示：' + prev.hint) : null,
      ]));

      const input = h('input', {
        placeholder: '敲英文，回车提交',
        autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
        style: {
          width: '100%', padding: '13px 14px', borderRadius: '12px', boxSizing: 'border-box',
          background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--text)',
          fontSize: '17px', fontFamily: 'inherit',
        },
      });
      main.appendChild(input);
      setTimeout(() => input.focus(), 60);

      const submit = () => {
        const val = input.value;
        if (!val.trim()) return;
        const ok = isCorrectFn(val, it);
        if (ok) {
          answers[wid] = { correctAt: prev && prev.tried ? 2 : 1, tried: 1 };
          cur++;
          renderExam();
        } else {
          // 第一次错：给提示、留在本题；第二次错：直接判错放行
          const n = ((prev && prev.tried) || 0) + 1;
          if (n >= 2) {
            answers[wid] = { correctAt: 0, tried: n };
            cur++;
            renderExam();
          } else {
            answers[wid] = { correctAt: 0, tried: n, hint: hintFn(it, val) };
            renderExam();
            toast('不对，再试一次');
          }
        }
      };

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
      main.appendChild(h('button', {
        class: 'hud-btn',
        style: { width: '100%', padding: '13px', marginTop: '10px', background: 'var(--accent)', color: '#08120c', fontWeight: '700' },
        onclick: submit,
      }, '提交'));
    }

    // ---- 阶段三：结算 ----
    function finish() {
      mergeAnswers();

      // 【为什么每组都存一次】43 个词分 5 组，用户很可能学完第 1、2 组就退出。
      //   如果等全部组走完才写存档，中途退出等于白学——
      //   下次进来还是"已掌握 0 个"，这是最伤人的体验。
      //   每组结算立刻落盘，退出时进度就停在这一组。
      //
      // 【为什么落盘和渲染要拆开】AI 重排分组后需要重画结算页，
      //   如果直接再调一次 finish()，同一组的成绩会被存第二遍，
      //   分数和已掌握数都会翻倍。所以落盘只走 finish()，
      //   重排只调 drawSettle()。
      if (onGroupDone) {
        try { onGroupDone(resOf(), answers, items); } catch (e) { console.warn('[单词机] 本组存档失败', e); }
      }
      drawSettle();
    }

    /** 当前组的判分结果（纯计算，不落盘） */
    function resOf() {
      const list = items.map((it) => ({ wid: L.wordId(it.en), borrowed: false }));
      const ans = items.map((it) => {
        const wid = L.wordId(it.en);
        const a = answers[wid];
        return { wid, correctAt: a ? a.correctAt : 0 };
      });
      return L.computeGroup({ items: list, answers: ans });
    }

    /** 画组结算页。只读状态，不写存档。 */
    function drawSettle() {
      const res = resOf();
      const isLast = gi + 1 >= groups.length;
      main.innerHTML = '';

      // 组进度条：让用户一眼看到"还剩几组"
      main.appendChild(h('div', {
        style: { display: 'flex', gap: '5px', marginBottom: '18px' },
      }, groups.map((_, i) => h('div', {
        style: {
          flex: '1', height: '4px', borderRadius: '2px',
          background: i < gi ? 'var(--accent)' : i === gi ? 'var(--accent-2)' : 'var(--line)',
        },
      }))));

      main.appendChild(h('div', { style: { textAlign: 'center', padding: '10px 16px 26px' } }, [
        h('div', { style: { fontSize: '46px', marginBottom: '10px' } }, res.passed ? '🎉' : '💪'),
        h('div', { style: { fontSize: '22px', fontWeight: '800', marginBottom: '6px' } },
          res.passed ? '本组过关' : '本组再来一次'),
        h('div', { style: { fontSize: '13px', color: 'var(--text-3)', marginBottom: '4px' } },
          '第 ' + (gi + 1) + ' / ' + groups.length + ' 组 · ' + items.length + ' 个'),
        h('div', { style: { fontSize: '14px', color: 'var(--text-2)' } },
          res.score + ' / ' + res.fullMark + ' 分（达标线 85%）'),
        h('div', { style: { fontSize: '13px', color: 'var(--text-3)', marginTop: '8px' } },
          '一次答对 ' + res.firstTry.length + ' 个 · 二次答对 ' + res.secondTry.length + ' 个'),
      ]));

      // 不达标 → 只重考本组错词
      if (!res.passed) {
        const retry = items.filter((it) => {
          const a = answers[L.wordId(it.en)];
          return !a || a.correctAt !== 1;
        });
        if (retry.length) {
          main.appendChild(h('button', {
            class: 'hud-btn',
            style: { width: '100%', padding: '13px', background: 'var(--accent)', color: '#08120c', fontWeight: '700' },
            onclick: () => {
              // 重考只走考试，不再学一遍：错词刚才已经抄过一次了
              items = L.shuffle(retry);
              answers = {};
              cur = 0;
              renderExam();
            },
          }, '只重考错词（' + retry.length + ' 个）'));
        }
      }

      // ---- AI 智能分组 ----
      // 【为什么放在组结算页而不是开头】开头就重排的话，用户还没看到词，
      //   不知道 AI 分得好不好；而且分组一变，之前学过的组的进度就作废了。
      //   放在组与组之间：已经过关的组原样保留，只把「还没学的词」重新分。
      //   这样既尊重已完成的进度，又能让剩下的词按语义聚在一起。
      if (!isLast && allItems.length > GROUP_SIZE) {
        const restWords = [];
        for (let k = gi + 1; k < groups.length; k++) restWords.push(...groups[k]);
        if (restWords.length > GROUP_SIZE) {
          main.appendChild(h('button', {
            class: 'hud-btn',
            style: {
              width: '100%', padding: '11px', marginTop: '8px',
              fontSize: '13px', background: 'var(--bg-3)',
              border: '1px solid var(--line)',
            },
            onclick: async (e) => {
              const btn = e.currentTarget;
              const old = btn.textContent;
              btn.disabled = true;
              btn.textContent = 'AI 分组中…';
              try {
                // 【为什么要先判 ready】aiSplitGroups 内部遇到「没填 Key」会
                //   自己 catch 掉并退回本地硬切，返回一个完全合法的分组。
                //   不判的话，用户会看到「已按语义重新分组」——
                //   但其实一个字都没发给 AI，分出来的还是原来那批。
                if (!(await aiReady())) {
                  btn.disabled = false;
                  btn.textContent = old;
                  toast('还没填 AI 的 Key，去设置里配一下', 3200);
                  return;
                }
                const re = await aiSplitGroups(restWords, GROUP_SIZE);
                if (!re || !re.length) throw new Error('AI 没有返回分组');
                // 只替换 gi 之后的部分，已过关的组不动
                groups = groups.slice(0, gi + 1).concat(re);
                toast('已按语义重新分组（剩 ' + re.length + ' 组）', 'good');
                drawSettle();
              } catch (err) {
                btn.disabled = false;
                btn.textContent = old;
                toast('AI 分组失败：' + (err && err.message ? err.message : '未知错误'), 3200);
              }
            },
          }, '🤖 AI 智能分组（重排剩下的 ' + restWords.length + ' 个词）'));
        }
      }

      // 下一组 / 全部完成
      main.appendChild(h('button', {
        class: 'hud-btn',
        style: {
          width: '100%', padding: '13px', marginTop: '8px',
          background: isLast ? 'var(--accent)' : 'var(--bg-3)',
          color: isLast ? '#08120c' : 'var(--text)',
          fontWeight: isLast ? '700' : '400',
          border: isLast ? 'none' : '1px solid var(--line)',
        },
        onclick: () => {
          if (!isLast) {
            gi++;
            items = groups[gi];
            studyAt = 0; studyTyped = ''; studyMiss = false;
            renderLearn();
            return;
          }
          // 全部组走完：把总答案一次性交给调用方存档
          screen2.remove();
          const totalList = allItems.map((it) => ({ wid: L.wordId(it.en), borrowed: false }));
          const totalAns = allItems.map((it) => ({
            wid: L.wordId(it.en),
            correctAt: (allAnswers[L.wordId(it.en)] || {}).correctAt || 0,
          }));
          const total = L.computeGroup({ items: totalList, answers: totalAns });
          // 只做汇总（比如弹个总结），存档已经在每组结算时写过了
          onFinish(total, allAnswers);
          renderHome();
        },
      }, isLast ? '完成' : '下一组（' + (gi + 2) + ' / ' + groups.length + '）'));
    }

    renderLearn();
  }

  /* ---------------- 单词会话 ---------------- */

  function startWordLearn(level) {
    /**
     * 把一次结算的结果并进生词本和关卡进度，然后落盘。
     * 【为什么单独抽出来】分组之后每组结算都要存一次，
     *   逻辑必须能反复调用且幂等——同一组重考两次不能把 right 加两遍。
     *   这里用 answers 里的最终 correctAt 覆盖，而不是累加，保证幂等。
     */
    async function commit(res, answers, groupItems) {
      const now = Date.now();
      const DAY = 86400000;

      for (const it of groupItems) {
        const wid = L.wordId(it.en);
        const a = (answers[wid] || {}).correctAt || 0;
        const v = recordSave.vocab[wid] || { en: it.en, zh: it.zh, box: 0, due: 0, wrong: 0, right: 0, lastAt: 0 };
        v.en = it.en;
        v.zh = it.zh || v.zh;
        v.lastAt = now;
        // 一次答对才升档；没答对降档但不归零（连续答错也要保留一点记忆痕迹）
        if (a === 1) { v.right += 1; v.box = Math.min(9, v.box + 1); }
        else { v.wrong += 1; v.box = Math.max(0, v.box - 1); }
        v.due = now + DAY * Math.pow(2, Math.min(v.box, 6));
        recordSave.vocab[wid] = v;
      }

      // 记录「哪些词一次答对过」——原版 level.completed 的口径。
      // 这个集合是「继续学习」的依据：下次进来只学没掌握的，不用 43 个重来。
      const k = String(level.num);
      const old = recordSave.levels[k] || { done: false, best: 0, at: 0, completed: [] };
      const doneSet = new Set(old.completed || []);
      for (const it of groupItems) {
        const wid = L.wordId(it.en);
        const a = (answers[wid] || {}).correctAt || 0;
        if (a === 1) doneSet.add(wid);
      }
      recordSave.levels[k] = {
        done: !!old.done || res.passed,
        best: Math.max(old.best || 0, res.score),
        at: now,
        completed: [...doneSet],
      };

      const r = await saveRecordSave(recordSave);
      if (!r.ok) toast('存档写入失败：' + (r.error || '未知'));
      return r;
    }

    runSession({
      title: level.name || '单词学习',
      items: level.words,
      isCorrectFn: (input, it) => L.isCorrectAny(input, it.en),
      hintFn: (it, typed) => L.makeHint(it.en, typed),
      // 每组结算后立刻落盘，中途退出不丢进度
      onGroupDone: async (res, answers, groupItems) => {
        await commit(res, answers, groupItems);
      },
      // 全部组走完只做一次汇总提示，存档已经在每组写过了
      onFinish: async (res) => {
        toast(res.passed ? '全部完成，已保存' : '已保存', res.passed ? 'good' : 'none');
      },
    });
  }

  /**
   * 让 AI 讲讲这篇课文怎么背。
   *
   * 【为什么单独一个弹层而不是塞进背诵界面】背诵界面是全屏的，
   *   中途弹东西会打断节奏。而且总结看一遍就够了，
   *   放进背诵流程里反而碍事。所以从首页进，看完再开始背。
   *
   * 【为什么存进存档】总结要花用户的 API 费用。
   *   存在 textSave.texts[].aiNotes 里，下次直接看，不用再花一次钱。
   *   课文原文变了才重新生成（用 aiVersion 记原文指纹）。
   */
  function openTextAiNotes(tx) {
    const fullText = tx.sentences.map((s) => s.en).join(' ');
    // 原文指纹：课文一改，旧总结就不该再显示
    const ver = L.wordId(fullText);
    const rec = textSave.texts.find((t) => String(t.id) === String(tx.num));
    const cached = rec && rec.aiNotes && rec.aiVersion === ver ? rec.aiNotes : null;

    const bodyBox = h('div', {
      style: { fontSize: '13px', lineHeight: '1.75', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: '60px' },
    });

    function renderNotes(notes) {
      bodyBox.innerHTML = '';
      if (!notes) { bodyBox.textContent = '还没生成，点下面的按钮让 AI 读一遍。'; return; }
      if (notes.summary) {
        bodyBox.appendChild(h('div', { style: { marginBottom: '10px' } }, notes.summary));
      }
      if (notes.tips && notes.tips.length) {
        bodyBox.appendChild(h('div', { style: { fontWeight: '700', marginBottom: '4px', color: 'var(--accent)' } }, '怎么背'));
        for (const t of notes.tips) {
          bodyBox.appendChild(h('div', { style: { marginBottom: '6px', paddingLeft: '10px', borderLeft: '2px solid var(--line)' } }, t));
        }
      }
      if (notes.keywords && notes.keywords.length) {
        bodyBox.appendChild(h('div', { style: { fontWeight: '700', margin: '10px 0 4px', color: 'var(--accent)' } }, '关键词'));
        bodyBox.appendChild(h('div', { style: { color: 'var(--muted)' } }, notes.keywords.join(' · ')));
      }
    }

    renderNotes(cached);

    const goBtn = h('button', {
      class: 'hud-btn',
      style: { flex: '1', padding: '11px', background: 'var(--accent)', color: '#08120c', fontWeight: '700' },
      onclick: async () => {
        goBtn.disabled = true;
        const old = goBtn.textContent;
        goBtn.textContent = 'AI 正在读…';
        try {
          const notes = await aiSummarizeText(fullText);
          // 写进存档，下次不再花钱
          const ensured = ensureText(tx);
          if (!ensured.ok) { toast(ensured.reason); return; }
          const t = ensured.text;
          t.aiNotes = notes;
          t.aiVersion = ver;
          t.updatedAt = Date.now();
          const r = await saveTextSave(textSave);
          if (!r.ok) toast('存档写入失败：' + (r.error || '未知'));
          renderNotes(notes);
        } catch (e) {
          toast('AI 失败：' + ((e && e.message) || '未知原因'));
        } finally {
          goBtn.disabled = false;
          goBtn.textContent = old;
        }
      },
    }, cached ? '重新生成' : '让 AI 讲讲');

    const sheet = modal('怎么背这篇', [
      h('div', { class: 'hint', style: { marginBottom: '8px' } }, '第 ' + tx.num + ' 篇 · ' + tx.sentences.length + ' 句'),
      bodyBox,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, [
        h('button', { class: 'hud-btn', style: { flex: '1', padding: '11px' }, onclick: () => sheet.close() }, '关闭'),
        goBtn,
      ]),
    ]);
  }

  /**
   * 确保这篇课文已经在 textSave.texts 里，没有就新建。
   *
   * 【为什么抽成函数】原来「AI 讲讲」和「开始背诵」各自写了一遍
   *   `find(...) || push(...)`，两处都要判断上限、都要算字节。
   *   分开写迟早有一处漏掉限制——事实上原来两处都没判上限。
   *
   * @returns {{ ok: boolean, text?: object, reason?: string }}
   */
  function ensureText(tx) {
    const exist = textSave.texts.find((x) => String(x.id) === String(tx.num));
    if (exist) return { ok: true, text: exist };

    if (textSave.texts.length >= TEXT_MAX) {
      return { ok: false, reason: `最多 ${TEXT_MAX} 篇课文，先在列表里删一篇` };
    }
    const t = {
      id: String(tx.num), name: tx.name, sentences: tx.sentences,
      completed: [], createdAt: Date.now(), updatedAt: Date.now(),
      aiNotes: null, aiVersion: '',
    };
    // 先试算，超字节就不落盘
    const probe = { ...textSave, texts: textSave.texts.concat([t]) };
    if (measureTextSave(probe) > TEXT_BYTES) {
      return { ok: false, reason: `课文总计超过 ${fmtBytes(TEXT_BYTES)}，这篇太长存不下` };
    }
    textSave.texts.push(t);
    return { ok: true, text: t };
  }

  function startTextLearn(tx) {
    runSession({
      title: tx.name || '课文背诵',
      items: tx.sentences,
      isCorrectFn: (input, it) => L.isCorrectText(input, it.en),
      hintFn: (it, typed) => L.makeTextHint(it.en, typed),
      onFinish: async (res, answers) => {
        const ensured = ensureText(tx);
        if (!ensured.ok) { toast(ensured.reason); return; }
        const t = ensured.text;
        t.updatedAt = Date.now();
        for (const s of tx.sentences) {
          const sid = L.wordId(s.en);
          const a = (answers[sid] || {}).correctAt || 0;
          const r = textSave.recite[sid] || { box: 0, due: 0, wrong: 0, right: 0 };
          if (a === 1) {
            r.right++; r.box = Math.min(9, r.box + 1);
            if (t.completed.indexOf(sid) < 0) t.completed.push(sid);
          } else { r.wrong++; r.box = Math.max(0, r.box - 1); }
          r.due = Date.now() + 86400000 * Math.pow(2, Math.min(r.box, 6));
          textSave.recite[sid] = r;
        }
        const r = await saveTextSave(textSave);
        if (!r.ok) toast('存档写入失败：' + (r.error || '未知'));
        else toast('已保存', 'good');
      },
    });
  }

  renderHome();
}
