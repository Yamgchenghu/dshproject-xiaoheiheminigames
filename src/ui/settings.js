/**
 * 设置页。
 *
 * 【为什么设置里要放"模组实验室"入口】用户要求模组入口"藏得很深"，
 *   但又必须可发现（否则等于没做）。做法是：设置 → 关于 → 连点版本号 7 次，
 *   才出现「实验性功能」分组。这符合"深但可达"，也不像在藏后门。
 */
import { h, formatDuration, syncRangeFill } from '../core/util.js';
import { GAMES } from '../games/index.js';
import { FEATURES } from '../core/variant.js';
import { toast } from './toast.js';
import { getMode, storageGet, storageSet, getUser } from '../sdk/hb.js';
import { TTS_PROVIDERS, loadTtsConfig, saveTtsConfig, speak as speakTts } from '../core/tts.js';
import { loadClone, clearClone, cloneVoice, createRecorder } from '../core/voice-clone.js';
import { AI_PROVIDERS, loadAiConfig, saveAiConfig } from '../core/ai.js';
import { loadProfile, saveProfile, emptyProfile, profileUsage } from '../core/achievements.js';
import { modUsage } from '../mod/store.js';
import { wheelUsage } from '../tools/wheel/store.js';
import { scoreUsage, resetScoresCache } from '../core/scores.js';
import { measureShishanSave, shishanCapacity } from '../shishan/save-bridge.js';
import { SCOPES, clearScope } from '../core/save.js';
import { exportJson, importJson } from '../sdk/files.js';
import { openModLab } from '../mod/lab.js';
import { applyAudioSettings, playBgm } from '../core/audio.js';
import { VERSION } from '../version.js';

let tapCount = 0;
let tapTimer = 0;


/**
 * 造一个 MD3 风格的下拉框（原生 <select>）。
 *
 * 【为什么用原生 select 而不是自己拼弹层】小程序跑在安卓 WebView 里，
 *   原生 select 会直接拉起系统选择器，触控手感、无障碍、返回键行为
 *   全都是系统给的，比自己拼一个 div 弹层可靠得多。
 *   代价是样式只能改到有限程度（边框/圆角/内边距可以，选项列表不行），
 *   这个取舍是划算的。
 *
 * @param {Array<{id:string,name:string}>} options 候选项
 * @param {string} value 当前值
 * @param {(v:string)=>void} onChange 选中回调
 */
function makeSelect(options, value, onChange) {
  const el = h('select', {
    style: {
      width: '100%', padding: '10px 12px', borderRadius: '10px', boxSizing: 'border-box',
      background: 'var(--md-surface-container-high)', border: '1px solid var(--md-outline)',
      color: 'var(--md-on-surface)', fontSize: '13px', fontFamily: 'inherit',
      marginTop: '8px', appearance: 'none', WebkitAppearance: 'none',
      // 右侧画一个下拉箭头：原生 select 在部分 WebView 里箭头会消失，用背景图画最稳
      backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2379747e' stroke-width='1.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")",
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 12px center',
      paddingRight: '34px',
    },
    onchange: (e) => onChange(e.target.value),
  });
  // 【为什么要留一个空选项】留空 = 用供应商默认模型，这是原来的语义，必须保留：
  //   用户可能想跟随供应商升级默认值，而不是钉死某个型号。
  el.appendChild(h('option', { value: '' }, '跟随默认'));
  for (const o of options) {
    const opt = h('option', { value: o.id }, o.name);
    if (o.id === value) opt.selected = true;
    el.appendChild(opt);
  }
  // 存的值不在候选里（旧版本手填过别的型号）：补一个选项进去，
  // 否则 select 会自动跳到第一项，把用户的配置静默改掉
  if (value && !options.some((o) => o.id === value)) {
    const opt = h('option', { value }, value + '（自定义）');
    opt.selected = true;
    el.appendChild(opt);
  }
  return el;
}
export function openSettings(state) {
  const mask = h('div', { class: 'modal-mask' });
  const modal = h('div', { class: 'modal' });
  mask.appendChild(modal);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  document.body.appendChild(mask);

  function close() {
    mask.remove();
  }

  /**
   * 【为什么要包一层】render 变成 async 之后（要读 TTS 配置），
   *   直接调 render() 会返回一个没人接的 Promise。
   *   万一里面抛错，浏览器只会在控制台留一条未处理的拒绝，
   *   界面上则是"点了没反应"。包一层至少能把错误打出来。
   */
  function safeRender() {
    render().catch((e) => {
      console.warn('[设置] 渲染失败', e);
      toast('设置页渲染出错');
    });
  }

  async function render() {
    const p = state.profile || emptyProfile();
    const s = p.settings || {};
    modal.innerHTML = '';
    modal.appendChild(h('div', { class: 'modal-grip' }));
    modal.appendChild(h('h2', {}, '设置'));
    modal.appendChild(h('div', { class: 'm-sub' }, `运行环境：${state.modeLabel || getMode()}`));

    // 声音
    // 【为什么工具版整段跳过】工具版没有游戏，也就没有 BGM 和打击音效。
    //   保留这个开关，用户打开后听到的永远是静音，只会以为功能坏了。
    if (FEATURES.games) modal.appendChild(
      h('div', { class: 'card' }, [
        h('h3', {}, '声音'),
        row('背景音乐', '每款游戏有独立 BGM，循环播放', s.bgm, async (v) => {
          p.settings.bgm = v;
          await saveProfile(p);
          applyAudioSettings();
          // 打开时给一段试听：用户不用退出去开一局才知道有没有声音
          if (v) playBgm(GAMES[0].bgm || 'g2048');
          state.onSettingsChange?.(p);
          safeRender();
        }),
        (() => {
          // 【为什么要把百分比文字做成可变节点】原来这里写的是
          //   h('div', { class: 'hint' }, `${...}%`)——字符串在渲染那一刻
          //   就算死了，oninput 只改了数据和音频音量，没动这个节点。
          //   于是不管怎么拖，屏幕上永远显示打开设置页时的那个值（50%）。
          //   音频其实是生效的，纯粹是显示没刷新。
          const pctEl = h('div', { class: 'hint' }, Math.round((s.bgmVolume ?? 0.5) * 100) + '%');
          const input = h('input', {
            type: 'range', min: '0', max: '100', step: '5',
            value: String(Math.round((s.bgmVolume ?? 0.5) * 100)),
            oninput: (e) => {
              const pct = Number(e.target.value);
              p.settings.bgmVolume = pct / 100;
              // 先刷新文字再播音：拖动时手感要跟手
              pctEl.textContent = pct + '%';
              // 波浪分段要跟着滑，否则视觉上停在初始位置
              syncRangeFill(e.target);
              // 拖动时立刻生效，不等松手：调音量必须能即时听到
              applyAudioSettings();
            },
            // 【为什么放到 change 才落盘】input 事件在拖动过程中会连续触发，
            //   每一步都 await saveProfile 会往云存档写几十次，
            //   既卡又浪费。松手（change）才写一次就够了。
            onchange: async () => {
              await saveProfile(p);
              state.onSettingsChange?.(p);
            },
          });
          // 初始值也要铺一次波浪，否则打开设置页时波浪停在 50%
          queueMicrotask(() => syncRangeFill(input));
          return h('div', { class: 'row' }, [
            h('div', {}, [h('div', { class: 'label' }, '音乐音量'), pctEl]),
            input,
          ]);
        })(),
        row('音效', '点击、得分、爆炸等短音效', s.sfx, async (v) => {
          p.settings.sfx = v;
          await saveProfile(p);
          state.onSettingsChange?.(p);
          safeRender();
        }),
      ]),
    );

    // 语音合成（在线 TTS）
    //
    // 【为什么 Key 要用户自己填】小程序不提供任何内置 Key。
    //   一是配额会被一个人用光，二是 Key 写进包里等于公开泄露。
    //   用户填自己的 Key，费用和配额都是自己的，我们只做转发。
    //
    // 【为什么 Key 只存本地】云存档是明文可读的，放进去等于把 Key 交出去。
    //   所以它走 storage 而不是 cloud_storage，换设备要重新填。
    const ttsCfg = await loadTtsConfig();
    const keyInput = h('input', {
      type: 'password',
      placeholder: '粘贴你的 API Key',
      value: ttsCfg.apiKey || '',
      autocomplete: 'off', spellcheck: 'false',
      style: {
        width: '100%', padding: '10px 12px', borderRadius: '10px', boxSizing: 'border-box',
        background: 'var(--bg-3)', border: '1px solid var(--line)',
        color: 'var(--text)', fontSize: '13px', fontFamily: 'inherit',
      },
    });
    // 【模型/音色改成下拉框】原来让人手打模型 ID，拼错一个字母就只报"试听失败"，
    //   根本不知道错在哪。改成下拉框后，选项就是供应商真实支持的型号，
    //   用户不可能填错。值仍然存字符串，和旧存档完全兼容。
    let ttsModel = ttsCfg.model || '';
    let ttsVoice = ttsCfg.voice || '';
    const modelSlot = h('div', {});
    const voiceSlot = h('div', {});

    const aiCfg = await loadAiConfig();
    const aiKeyInput = h('input', {
      type: 'password',
      placeholder: 'API Key（和语音合成可以填同一个）',
      value: aiCfg.apiKey || '',
      style: {
        width: '100%', padding: '10px 12px', borderRadius: '10px', boxSizing: 'border-box',
        background: 'var(--bg-3)', border: '1px solid var(--line)',
        color: 'var(--text)', fontSize: '13px', fontFamily: 'inherit', marginTop: '8px',
      },
    });
    // AI 模型同样改成下拉框，理由同 TTS：手打模型 ID 拼错只会得到一句笼统的失败提示
    let aiModel = aiCfg.model || '';
    const aiModelSlot = h('div', {});
    const aiProviderRow = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' } });
    let pickedAi = aiCfg.provider || 'deepseek';
    const renderAiProviders = () => {
      aiProviderRow.innerHTML = '';
      for (const p of AI_PROVIDERS) {
        const on = p.id === pickedAi;
        aiProviderRow.appendChild(h('button', {
          class: 'btn',
          style: {
            padding: '6px 10px', fontSize: '12px',
            background: on ? 'var(--md-secondary-container)' : 'var(--md-surface-container-high)',
            color: on ? 'var(--md-on-secondary-container)' : 'var(--md-on-surface)',
            fontWeight: on ? '700' : '400',
            border: on ? 'none' : '1px solid var(--md-outline-variant)',
          },
          onclick: () => {
            if (pickedAi === p.id) return;
            pickedAi = p.id;
            // 换供应商时型号清空，回到"跟随默认"（理由同 TTS）
            aiModel = '';
            renderAiProviders();
          },
        }, p.name));
      }
      // 模型下拉框随供应商重建
      const prov = AI_PROVIDERS.find((x) => x.id === pickedAi) || AI_PROVIDERS[0];
      aiModelSlot.innerHTML = '';
      aiModelSlot.appendChild(makeSelect(prov.models || [], aiModel, (v) => { aiModel = v; }));
    };
    if (FEATURES.wordMachine) renderAiProviders();

    const providerRow = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' } });
    let pickedProvider = ttsCfg.provider || 'mimo';

    // 【模型/音色下拉框随供应商重建】换一家供应商，它支持的型号完全不同，
    //   旧选项必须整个换掉。所以下拉框不能只建一次，要放在这个函数里重建。
    const renderTtsSelects = () => {
      const prov = TTS_PROVIDERS.find((x) => x.id === pickedProvider) || TTS_PROVIDERS[0];
      modelSlot.innerHTML = '';
      modelSlot.appendChild(makeSelect(prov.models || [], ttsModel, (v) => { ttsModel = v; }));
      voiceSlot.innerHTML = '';
      voiceSlot.appendChild(makeSelect(prov.voices || [], ttsVoice, (v) => { ttsVoice = v; }));
    };

    const renderProviders = () => {
      providerRow.innerHTML = '';
      for (const p of TTS_PROVIDERS) {
        const on = p.id === pickedProvider;
        providerRow.appendChild(h('button', {
          class: 'btn',
          style: {
            padding: '6px 10px', fontSize: '12px',
            background: on ? 'var(--md-secondary-container)' : 'var(--md-surface-container-high)',
            color: on ? 'var(--md-on-secondary-container)' : 'var(--md-on-surface)',
            fontWeight: on ? '700' : '400',
            border: on ? 'none' : '1px solid var(--md-outline-variant)',
          },
          onclick: () => {
            if (pickedProvider === p.id) return;
            pickedProvider = p.id;
            // 换供应商时把型号和音色清空，回到"跟随默认"：
            //   留着上一家的型号，下拉框会显示成"自定义"，容易让人以为配错了
            ttsModel = '';
            ttsVoice = '';
            renderProviders();
          },
        }, p.name));
      }
      renderTtsSelects();
    };
    if (FEATURES.wordMachine) renderProviders();

    // 【为什么语音合成只给工具版】转盘播报、单词朗读、古诗吟诵——这三个
    //   需要 TTS 的功能全在工具版。游戏版一句语音都不播，留着这张卡
    //   只会让用户填一堆 Key 然后发现没有任何地方用到。
    if (FEATURES.wordMachine) modal.appendChild(
      h('div', { class: 'card' }, [
        h('h3', {}, '语音合成'),
        h('div', { class: 'hint', style: { marginBottom: '10px', lineHeight: '1.65' } },
          '转盘播报、单词朗读、古诗吟诵都用这里的设置。留空则使用系统语音。'
          + 'Key 只存在本机，不会同步到云端，也不会出现在导出的存档里。'),
        providerRow,
        keyInput,
        modelSlot,
        voiceSlot,
        h('div', { class: 'btn-row', style: { marginTop: '10px' } }, [
          h('button', {
            class: 'btn',
            onclick: async () => {
              const apiKey = (keyInput.value || '').trim();
              if (!apiKey) { toast('请先填 API Key'); return; }
              await saveTtsConfig({
                provider: pickedProvider,
                apiKey,
                model: (ttsModel || '').trim(),
                voice: (ttsVoice || '').trim(),
                enabled: true,
              });
              toast('已保存，正在试听…');
              // 立刻试听一句，让用户确认 Key 和音色真的能用，
              // 而不是等到抽奖时才发现配错了
              try {
                const ok = await speakTts('语音合成已就绪');
                if (!ok) toast('试听失败，检查 Key 或模型名');
              } catch { toast('试听失败'); }
            },
          }, '保存并试听'),
          h('button', {
            class: 'btn',
            onclick: async () => {
              await saveTtsConfig({ provider: pickedProvider, apiKey: '', model: '', voice: '', enabled: false });
              keyInput.value = '';
              ttsModel = ''; ttsVoice = '';
              renderTtsSelects();
              toast('已关闭在线语音，改用系统语音');
            },
          }, '关闭'),
        ]),
      ]),
    );

    // ---- 音色克隆 ----
    // 【为什么单独一张卡，不塞进语音合成里】克隆是「一次性配置」：
    //   录 10 秒音、上传、拿到一个 voice_id，之后长期复用。
    //   和每次朗读都要用的 Key/模型不是同一类操作，
    //   混在一起会让人以为每次朗读都要重新录。
    // 克隆音色同样是工具版专属（给单词朗读/古诗吟诵配音）
    const cloneCard = h('div', { class: 'card' });
    if (FEATURES.wordMachine) modal.appendChild(cloneCard);

    const renderClone = async () => {
      cloneCard.innerHTML = '';
      const info = await loadClone();
      cloneCard.appendChild(h('h3', {}, '克隆音色'));
      cloneCard.appendChild(
        h('div', { class: 'hint', style: { marginBottom: '10px', lineHeight: '1.65' } },
          '录一段 10 秒左右的话，用你自己的声音朗读转盘播报和单词。'
          + '需要先把上面的语音合成切换到智谱并填好 Key（克隆接口只认智谱）。'
          + '录音会上传到智谱用于生成音色，不会存进云存档。'),
      );

      if (info && info.voiceId) {
        cloneCard.appendChild(
          h('div', { style: { fontSize: '13px', marginBottom: '10px', color: 'var(--text-2)' } },
            '当前音色：' + (info.name || info.voiceId)),
        );
        cloneCard.appendChild(
          h('div', { class: 'btn-row' }, [
            h('button', {
              class: 'btn',
              onclick: async () => {
                // 把克隆音色写进 TTS 配置，之后所有朗读都用它
                const cfg = await loadTtsConfig();
                await saveTtsConfig({ ...cfg, provider: 'zhipu', voice: info.voiceId, enabled: true });
                toast('已启用克隆音色，正在试听…');
                try {
                  const ok = await speakTts('这是我的声音，好听吗');
                  if (!ok) toast('试听失败，检查智谱 Key');
                } catch { toast('试听失败'); }
              },
            }, '用这个音色试听'),
            h('button', {
              class: 'btn',
              onclick: async () => {
                await clearClone();
                toast('已删除克隆音色');
                renderClone();
              },
            }, '删除'),
          ]),
        );
        return;
      }

      // 还没克隆过：给录音入口
      const nameInput = h('input', {
        class: 'input',
        placeholder: '给这个音色起个名字（英文/数字）',
        value: 'my_voice',
      });
      const statusEl = h('div', { class: 'hint', style: { margin: '8px 0' } }, '');
      let recorder = null;
      let startedAt = 0;

      const recBtn = h('button', {
        class: 'btn primary',
        onclick: async () => {
          if (!recorder) {
            // 第一次点：开始录音
            try {
              recorder = createRecorder();
              await recorder.start();
              startedAt = Date.now();
              statusEl.textContent = '录音中… 说 10 秒左右，再点一次结束';
              recBtn.textContent = '结束录音';
            } catch (e) {
              recorder = null;
              // 【为什么要区分这句话】小程序运行在 iframe 里，
              //   麦克风权限由宿主页面决定。宿主没给 allow="microphone" 时
              //   getUserMedia 会直接抛 NotAllowedError，用户看到「不支持录音」
              //   会以为是我们的 bug。这里明确告诉他是环境限制。
              statusEl.textContent = /denied|NotAllowed/i.test(String(e && e.message))
                ? '浏览器拒绝了麦克风权限。请检查页面权限设置。'
                : '无法录音：' + (e && e.message ? e.message : '当前环境不支持');
            }
            return;
          }
          // 第二次点：停止并上传
          recBtn.textContent = '上传中…';
          recBtn.disabled = true;
          const secs = (Date.now() - startedAt) / 1000;
          try {
            const blob = await recorder.stop();
            recorder = null;
            if (!blob || !blob.size) throw new Error('没录到声音');
            // 官方要求 3~30 秒，太短音色不准，太长会被拒
            if (secs < 3) throw new Error('录音太短了，至少说 3 秒');
            if (secs > 30) throw new Error('录音太长了，请控制在 30 秒内');
            statusEl.textContent = '正在克隆，大约需要十几秒…';
            await cloneVoice(blob, nameInput.value, '');
            toast('克隆完成');
            renderClone();
          } catch (e) {
            statusEl.textContent = '克隆失败：' + (e && e.message ? e.message : '未知错误');
            recBtn.textContent = '开始录音';
            recBtn.disabled = false;
          }
        },
      }, '开始录音');

      cloneCard.appendChild(nameInput);
      cloneCard.appendChild(statusEl);
      cloneCard.appendChild(h('div', { class: 'btn-row', style: { marginTop: '6px' } }, [recBtn]));
    };
    renderClone();

    // AI（单词机用）
    // 【为什么 AI 也只给工具版】唯一的调用方是单词机的「AI 整理」
    //   「拍照识图」「课文总结」。游戏版不调任何模型。
    if (FEATURES.wordMachine) modal.appendChild(
      h('div', { class: 'card' }, [
        h('h3', {}, 'AI 整理'),
        h('div', { class: 'hint', style: { marginBottom: '10px', lineHeight: '1.65' } },
          '单词机的「AI 整理」「拍照识图」和课文总结用这里的设置。'
          + '只有你点按钮时才会请求，不会在后台自动调用，费用由你的 Key 承担。'
          + 'Key 只存在本机，不会同步到云端。'),
        aiProviderRow,
        aiKeyInput,
        aiModelSlot,
        h('div', { class: 'btn-row', style: { marginTop: '10px' } }, [
          h('button', {
            class: 'btn',
            onclick: async () => {
              await saveAiConfig({
                provider: pickedAi,
                apiKey: (aiKeyInput.value || '').trim(),
                model: (aiModel || '').trim(),
                visionProvider: pickedAi,
              });
              toast('AI 设置已保存');
            },
          }, '保存'),
          h('button', {
            class: 'btn',
            onclick: async () => {
              await saveAiConfig({ provider: pickedAi, apiKey: '', model: '', visionProvider: pickedAi });
              aiKeyInput.value = '';
              aiModel = '';
              renderAiProviders();
              toast('已清空 AI Key');
            },
          }, '清空'),
        ]),
      ]),
    );

    // 存档
    modal.appendChild(
      h('div', { class: 'card' }, [
        h('h3', {}, '存档'),
        h('div', { class: 'hint', style: { marginBottom: '10px', lineHeight: '1.65' } },
          '存档默认保存在小黑盒账号里。导出得到的是一个 JSON 文件，可以自己留底或换设备时导入。'),
        h('div', { class: 'btn-row' }, [
          h('button', {
            class: 'btn',
            onclick: async () => {
              const res = await exportJson(`迷你游戏存档-${Date.now()}.json`, {
                app: 'mini-games-tools',
                version: VERSION,
                exportedAt: Date.now(),
                profile: p,
              });
              if (res.ok) toast('已导出 ' + res.name);
              else if (!res.cancelled) toast('导出失败：' + (res.error || '未知'));
            },
          }, '导出存档'),
          h('button', {
            class: 'btn',
            onclick: async () => {
              const res = await importJson(['.json']);
              if (res.cancelled) return;
              if (!res.ok) return toast('导入失败：' + res.error);
              const data = res.data;
              if (!data || !data.profile) return toast('不是本应用的存档文件');
              if (!confirm('导入会覆盖当前进度，确定吗？')) return;
              await saveProfile(data.profile);
              state.profile = await loadProfile();
              state.onSettingsChange?.(state.profile);
              safeRender();
              toast('存档已导入');
            },
          }, '导入存档'),
          h('button', {
            class: 'btn danger',
            onclick: async () => {
              // 【为什么要把范围说清楚】原来只写"会清空所有游玩记录与成就"，
              //   实际却只清了 profile 一个域——最高分（scores）、诗山进度、
              //   单词机词表全都没动。用户点完发现榜上分数还在，以为没生效。
              //   现在把真正会被清掉的域列出来，并如实清干净。
              if (!confirm(
                '会清空以下全部进度，且无法恢复：\n'
                + '· 各游戏最高分（综合总分榜会归零）\n'
                + '· 游玩记录与成就\n'
                + '· 诗山寻踪进度\n'
                + '· 单词机词表与复习记录\n'
                + '· 设置项（AI/语音 Key 除外，它们只在本机）\n\n确定要清空吗？',
              )) return;
              // profile：游玩记录、成就、设置
              await saveProfile(emptyProfile());
              // scores：最高分。不清的话量化总分还是旧值，榜上不会归零。
              await clearScope('scores');
              resetScoresCache();
              // 诗山进度、单词机：有独立存档域，同样要清
              await clearScope('shishan').catch(() => {});
              for (const sc of ['word.lists', 'word.texts', 'word.records']) {
                await clearScope(sc).catch(() => {});
              }
              state.profile = await loadProfile();
              state.onSettingsChange?.(state.profile);
              safeRender();
              toast('已清空全部进度');
            },
          }, '清空进度'),
        ]),
      ]),
    );

    // 云存档用量
    // 【为什么要把这个显示出来】工坊给的配额是看不见的：用户写到一半
    //   才会发现"存不下了"。把每个域的 value 数和字节用量摆出来，
    //   配额就变成可以规划的东西，而不是撞墙才知道。
    const usageCard = h('div', { class: 'card' }, [
      h('h3', {}, '云存档用量'),
      h('div', { class: 'hint', style: { marginBottom: '10px', lineHeight: '1.65' } },
        '工坊云存档按 value 计费，每个 value 最多 16 KB。本应用把数据连续打包存放，' +
        '一个 value 装满才用下一个，不会因为分片浪费空间。'),
    ]);
    modal.appendChild(usageCard);
    renderUsage(usageCard);

    // 关于
    const verRow = h('div', { class: 'row' }, [
      h('div', {}, [
        h('div', { class: 'label' }, '版本'),
        h('div', { class: 'hint' }, '连点 7 次可开启实验性功能'),
      ]),
      h('div', { class: 'mono', style: { color: 'var(--text-2)' } }, 'v' + VERSION),
    ]);
    verRow.addEventListener('click', () => {
      tapCount++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => {
        tapCount = 0;
      }, 1600);
      if (tapCount >= 7) {
        tapCount = 0;
        p.settings.devMode = true;
        saveProfile(p);
        toast('实验性功能已开启');
        safeRender();
      }
    });

    modal.appendChild(
      h('div', { class: 'card' }, [
        h('h3', {}, '关于'),
        h('div', { class: 'hint', style: { lineHeight: '1.7', marginBottom: '8px' } },
          // 【为什么按版本写不同文案】两个小程序共用这套源码，
          //   写死一句话会在另一个版本里变成错误描述。
          FEATURES.games
            ? '复古游戏 · 扫雷 / 切水果 / 2048 / 贪吃蛇 / 流水入杯 / 诗山寻踪。'
              + '所有模式成绩量化后累加成综合总分榜。'
            : '学习与实用工具 · 云海转盘 / 单词机 / 诗山寻踪。游戏玩法请用「复古游戏」小程序。'),
        verRow,
      ]),
    );

    // 实验性功能（藏在这里）
    // 【为什么加 FEATURES.mods】模组实验室只对游戏有意义。工具版没有游戏，
    //   留着入口只会让人点进去看到一个空列表，所以整块隐藏。
    if (FEATURES.mods && p.settings?.devMode) {
      modal.appendChild(
        h('div', { class: 'card', style: { borderColor: 'rgba(255,182,72,0.35)' } }, [
          h('h3', {}, '⚗️ 实验性功能'),
          h('div', { class: 'hint', style: { marginBottom: '10px', lineHeight: '1.7' } },
            '模组实验室：用 Python 脚本在游戏启动瞬间注入，修改游戏内参数。带模组的对局不计入排行榜。'),
          h('button', {
            class: 'btn block',
            onclick: () => {
              close();
              openModLab(state);
            },
          }, '打开模组实验室'),
        ]),
      );
    }

    modal.appendChild(
      h('button', { class: 'btn block', style: { marginTop: '10px' }, onclick: close }, '关闭'),
    );
  }

  /** 异步填用量：这些数字要读云端，不能阻塞设置页打开 */
  async function renderUsage(card) {
    const list = h('div', { class: 'usage-list' }, [h('div', { class: 'hint' }, '统计中…')]);
    card.appendChild(list);
    try {
      const [wheelU, scoreU, profU] = await Promise.all([wheelUsage(), scoreUsage(), profileUsage()]);
      const modU = modUsage();
      list.innerHTML = '';

      const add = (name, detail, used, cap, values) => {
        const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
        list.appendChild(
          h('div', { class: 'usage-block' }, [
            h('div', { class: 'usage-top' }, [
              h('span', { class: 'usage-name' }, name),
              h('span', { class: 'usage-num' }, `${fmt(used)} / ${fmt(cap)}`),
            ]),
            h('div', { class: 'usage-bar' }, [
              h('div', { class: 'usage-fill', style: { width: pct + '%' } }),
            ]),
            h('div', { class: 'usage-sub' }, detail + (values ? ` · ${values} 个 value` : '')),
          ]),
        );
      };

      // 【模组源码为什么单独处理】它有两个不同的"容量"：
      //   - 用户可见的源码配额 96000 字节（MOD_BUDGET，超了就不让存）；
      //   - 云存档物理容量 8 个 value = 131072 字节。
      //   进度条按源码配额算（那才是玩家真正会被卡住的线），
      //   副标题把物理容量写清楚。
      // 【为什么 value 数不再写死】以前这里硬编码 3 / 6 / 4 / 4，
      //   用户每次扩容（模组 3→8、转盘 6→8、自动指令 4→5、单词机各 +1）
      //   都得记得回来改这几行，漏改就显示成错的数字。
      //   现在统一从 SCOPES 读，扩容只改 save.js 一处。
      // 【为什么这几行要按变体判断】用量列表是"这个版本真的会写哪些 key"，
      //   不是"仓库里有几个模块"。游戏版不碰转盘、也没有模组入口，
      //   列出这些行会让用户以为自己有这些数据，实际上是空的。
      // SCOPES 里的域定义就是唯一事实来源，value 数从这里数出来
      const valuesOf = (scope) => SCOPES[scope].count + (SCOPES[scope].extra || []).length;
      if (FEATURES.mods) {
        const mv = valuesOf('mod');
        add('模组源码', `Python 注入脚本 · 云存档可容纳 ${fmt(mv * 16384)}`, modU.used, modU.budget, mv);
      }
      if (FEATURES.wheel) {
        add('转盘数据', '转盘 / 选项 / 权重', wheelU.lib.bytes, wheelU.lib.capacity, valuesOf('wheel.lib'));
        add('转盘跳转', '跳转规则 / 抽取记录', wheelU.goto.bytes, wheelU.goto.capacity, valuesOf('wheel.goto'));
        add('自动指令', '转盘脚本', wheelU.script.bytes, wheelU.script.capacity, valuesOf('wheel.script'));
      }
      // 【为什么要把条数和剩余容量写出来】用户特别问到"最高分记录的占用"。
      //   只显示 KB 看不出"还能存多少个模式"——最高分是按
      //   "游戏.模式" 存成一个个短键的，条数才是有意义的信息。
      //   34 个模式全打满约 1 KB，1 个 value 是 16 KB，余量非常充足。
      add('最佳成绩',
        `各游戏 × 模式的最高分 · ${scoreU.entries} 条记录 · 剩余 ${fmt(scoreU.capacity - scoreU.bytes)}`,
        scoreU.bytes, scoreU.capacity, 1);
      add('个人资料', '时长 / 成就 / 设置', profU.bytes, profU.capacity, 1);
      // 【为什么诗山要单独一行】它占 save_20..save_21 两个 value，
      //   原来这里根本没列，导致下面"合计"少算 2 个 value（19 vs 实际 21）。
      //   玩家看到的总数和真实占用对不上，排查空间问题时会被误导。
      // 【为什么要取 .bytes】measureShishanSave 返回的是
      //   { bytes, json, mode } 这样的度量对象，不是数字。
      //   直接把对象塞进 add()，进度条会算成 NaN，显示「NaN KB / 31.3 KB」。
      const shishanMeasure = await measureShishanSave();
      add('诗山进度', '诗卷 / 藏品 / 章节（摘抄不存云端）',
        shishanMeasure.bytes, shishanCapacity(), 2);

      // 【为什么不再手写数字】原来这里硬编码 3+6+4+4+1+1，
      //   加了诗山之后忘了同步，显示就错了。改成从 SCOPES 累加，
      //   以后再加存档域不用改这里。
      const totalValues = Object.values(SCOPES).reduce((n, d) => n + d.count, 0);
      list.appendChild(
        h('div', { class: 'hint', style: { marginTop: '10px', lineHeight: '1.7' } },
          `合计 ${totalValues} 个 value，约 ${(totalValues * 16)} KB 上限。`),
      );
    } catch (e) {
      list.innerHTML = '';
      list.appendChild(h('div', { class: 'hint' }, '读取失败：' + e.message));
    }
  }

  function fmt(n) {
    if (!n) return '0 B';
    if (n < 1024) return n + ' B';
    return (n / 1024).toFixed(1) + ' KB';
  }

  function row(label, hint, value, onChange) {
    return h('div', { class: 'row' }, [
      h('div', {}, [h('div', { class: 'label' }, label), hint ? h('div', { class: 'hint' }, hint) : null]),
      h('div', {
        class: `switch${value ? ' on' : ''}`,
        onclick: (e) => {
          const next = !value;
          e.currentTarget.classList.toggle('on', next);
          onChange(next);
        },
      }),
    ]);
  }

  safeRender();
  return { close };
}
