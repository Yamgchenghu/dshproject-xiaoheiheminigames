/**
 * 一杆清台（完整版）的挂载器。
 *
 * 【和 screen.js 的区别】screen.js 是「复古游戏」里的用法：
 *   它挂在已存在的壳上、切换 is-immersive、退出时回调重画列表。
 *   这个小程序没有壳——进去就是球桌，退出按钮也不该存在
 *   （小程序里 window.close() 关不掉宿主，留个按钮只会误导）。
 *   所以这里只做一件事：把 APK 的 DOM 原样挂上去，叫醒 game.js。
 *
 * 【为什么模板直接内联】小程序外壳的 CSP 是 `default-src 'none'`，
 *   iframe 会被直接拦掉，只能把 DOM / CSS / JS 全部搬进来。
 */
import { h } from '../../core/util.js';
import { recordBest } from '../../core/scores.js';
import { submitTotalScore } from '../../sdk/leaderboard.js';
import { accountForBoard } from '../../sdk/account.js';
import { computeRunScore } from './scoring.js';
import { readScope, writeScope } from '../../core/save.js';
import './pool.css';
import './game.js';

/** 游戏 DOM 模板（APK 原版 index.html 的 body 部分，已去掉 script 标签） */
const TEMPLATE = "<div class=\"app\" id=\"poolApp\">\r\n  <main class=\"stage\" id=\"stage\">\r\n    <canvas id=\"felt\" aria-label=\"台球桌\"></canvas>\r\n\r\n    <div class=\"stage-top\">\r\n      <div class=\"brand\">\r\n        <div class=\"logo-ball\"><span>8</span></div>\r\n        <div class=\"brand-text\">\r\n          <h1>一杆清台</h1>\r\n          <span id=\"modeTag\">经典八球</span>\r\n        </div>\r\n      </div>\r\n      <div class=\"top-actions\">\r\n        <button class=\"icon-btn\" id=\"btnSound\" aria-label=\"音效\" aria-pressed=\"true\">\r\n          <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M4 9.5v5h3.6L13 19V5L7.6 9.5H4z\"/><path class=\"wave\" d=\"M16 8.6a5 5 0 010 6.8\"/><path class=\"wave\" d=\"M18.4 6a8.6 8.6 0 010 12\"/><path class=\"mute\" d=\"M4 4l16 16\"/></svg>\r\n        </button>\r\n        <button class=\"icon-btn on\" id=\"btnAim\" aria-label=\"辅助线\" aria-pressed=\"true\">\r\n          <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"5.2\"/><path d=\"M12 2v4M12 18v4M2 12h4M18 12h4\"/><circle cx=\"12\" cy=\"12\" r=\"1.1\" class=\"fill\"/></svg>\r\n        </button>\r\n        <button class=\"icon-btn\" id=\"btnMenu\" aria-label=\"菜单\">\r\n          <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M4 7h16M4 12h16M4 17h16\"/></svg>\r\n        </button>\r\n      </div>\r\n    </div>\r\n\r\n    <div class=\"banner\" id=\"banner\"><b></b><span></span></div>\r\n    <div class=\"ai-badge\" id=\"aiBadge\"><i></i><span>AI 正在思考</span></div>\r\n    <div class=\"hint-bar\" id=\"hintBar\">拖动桌面瞄准 · 右侧球杆下滑击球</div>\r\n    <div class=\"hand-hint\" id=\"handHint\">拖动白球，放到合适的位置</div>\r\n\r\n    <div class=\"cue-dock\" id=\"cueDock\" aria-label=\"球杆控制\">\r\n      <div class=\"dock-top\">\r\n        <span>微调</span>\r\n        <button id=\"fineReset\" aria-label=\"角度归零\" title=\"角度归零\">↺</button>\r\n      </div>\r\n      <div class=\"fine-knob\" id=\"fineKnob\" role=\"slider\" tabindex=\"0\"\r\n           aria-label=\"上下滑动微调角度\" aria-valuemin=\"-20\" aria-valuemax=\"20\" aria-valuenow=\"0\">\r\n        <i></i>\r\n      </div>\r\n      <div class=\"cue-track\" id=\"cueTrack\" role=\"slider\" tabindex=\"0\"\r\n           aria-label=\"向下滑动球杆，滑动越长力度越大\" aria-valuemin=\"10\" aria-valuemax=\"100\" aria-valuenow=\"10\">\r\n        <div class=\"cue-fill\" id=\"cueFill\"></div>\r\n        <div class=\"cue-stick\" id=\"cueStick\">\r\n          <span class=\"cue-tip\"></span>\r\n          <span class=\"cue-shaft\"></span>\r\n          <span class=\"cue-wrap\"></span>\r\n          <span class=\"cue-butt\"></span>\r\n        </div>\r\n      </div>\r\n      <div class=\"dock-power\"><span>力度</span></div>\r\n      <div class=\"dock-hint\" id=\"dockHint\">下滑击球</div>\r\n    </div>\r\n  </main>\r\n\r\n  <aside class=\"panel\">\r\n    <div class=\"panel-head\">\r\n      <span class=\"panel-kicker\">MATCH</span>\r\n      <span class=\"rule-tag\" id=\"ruleTag\">8-BALL</span>\r\n    </div>\r\n\r\n    <div class=\"scoreboard\" id=\"scoreboard\"></div>\r\n\r\n    <div class=\"match-box\">\r\n      <div class=\"match-line\" id=\"matchStatus\">准备开球</div>\r\n      <div class=\"target-line\" id=\"targetLine\">目标：任意球</div>\r\n    </div>\r\n\r\n    <div class=\"swing-card\">\r\n      <div class=\"swing-arrow\">↓</div>\r\n      <div class=\"swing-text\">\r\n        <b>下滑球杆击球</b>\r\n        <span>滑动越长 · 力度越大</span>\r\n      </div>\r\n    </div>\r\n    <div class=\"fine-tip\"><span>↕</span> 竖杆顶部旋钮：上下滑动微调方向</div>\r\n\r\n    <div class=\"log\" id=\"log\"></div>\r\n\r\n    <div class=\"panel-foot\">\r\n      <button id=\"btnNew\"><span>↻</span> 新一局</button>\r\n      <button id=\"btnSettings\"><span>⚙</span> 设置</button>\r\n    </div>\r\n  </aside>\r\n\r\n  <!-- 【浮层为什么在 #poolApp 里面】APK 原版是整页旋转，浮层天然跟着转。 这里旋转只施加在 #poolApp 上，浮层若留在外面（body 下）， position:fixed 会相对视口定位、不跟着转，表现为「球桌横着但开始页的字竖排」。 放进内部 + CSS 改 absolute 之后，它们共享同一个变换矩阵。 -->\r\n<!-- 欢迎页 -->\r\n<div class=\"overlay show\" id=\"welcome\">\r\n  <div class=\"welcome-card\">\r\n    <div class=\"welcome-glow\"></div>\r\n    <div class=\"eyebrow\">PHYSICS POOL · DSH</div>\r\n    <h1>一杆清台</h1>\r\n    <p class=\"sub\">真实碰撞物理 · 完整规则 · 本地 AI 与大模型对手</p>\r\n\r\n    <div class=\"welcome-block\">\r\n      <label>玩法</label>\r\n      <div class=\"segment mode-seg\">\r\n        <button data-mode=\"8ball\" class=\"active\"><b>经典八球</b><small>全色 / 花色 / 黑八</small></button>\r\n        <button data-mode=\"9ball\"><b>九球</b><small>1 → 9 顺序</small></button>\r\n        <button data-mode=\"10ball\"><b>十球</b><small>1 → 10 顺序</small></button>        <button data-mode=\"rotation\"><b>轮转</b><small>最低球先碰</small></button>        <button data-mode=\"snooker\"><b>斯诺克</b><small>红球 / 彩球 / 计分</small></button>        <button data-mode=\"snooker6\"><b>6 红球</b><small>短局斯诺克</small></button>\r\n      </div>\r\n    </div>\r\n\r\n    <div class=\"welcome-block\">\r\n      <label>对局</label>\r\n      <div class=\"seat-setup\">\r\n        <div class=\"seat-row\">\r\n          <span class=\"seat-tag\">P1</span>\r\n          <select id=\"seat0Type\" aria-label=\"玩家1类型\"></select>\r\n          <select id=\"seat0Difficulty\" class=\"seat-diff\" aria-label=\"玩家1难度\">\r\n            <option value=\"easy\">休闲</option><option value=\"normal\">标准</option><option value=\"master\">专家</option>\r\n          </select>\r\n          <select id=\"seat0Think\" class=\"seat-think\" aria-label=\"玩家1思考深度（API参数）\" title=\"思考深度（API参数）\"></select>\r\n        </div>\r\n        <div class=\"seat-row\">\r\n          <span class=\"seat-tag\">P2</span>\r\n          <select id=\"seat1Type\" aria-label=\"玩家2类型\"></select>\r\n          <select id=\"seat1Difficulty\" class=\"seat-diff\" aria-label=\"玩家2难度\">\r\n            <option value=\"easy\">休闲</option><option value=\"normal\">标准</option><option value=\"master\">专家</option>\r\n          </select>\r\n          <select id=\"seat1Think\" class=\"seat-think\" aria-label=\"玩家2思考深度（API参数）\" title=\"思考深度（API参数）\"></select>\r\n        </div>\r\n      </div>\r\n      <div class=\"api-note\" id=\"welcomeApiNote\">沙箱次数由难度决定（休闲 0 / 标准 1 / 专家 5）；思考深度作为 API 参数。</div>\r\n    </div>\r\n\r\n    <div class=\"welcome-actions\">\r\n      <button class=\"primary\" id=\"startGame\">开始对局</button>\r\n      <button class=\"ghost\" id=\"welcomeImport\">导入</button>\r\n      <button class=\"ghost\" id=\"welcomeReplay\">回放</button>\r\n      <button class=\"ghost\" id=\"welcomeSettings\">设置</button>\r\n    </div>\r\n    <div class=\"fineprint\">API Key 保存在你的小黑盒云端存档（1 个 value），不会上传到任何第三方服务器。</div>\r\n  </div>\r\n</div>\r\n\r\n<!-- 菜单 -->\r\n<div class=\"overlay\" id=\"menuModal\">\r\n  <div class=\"modal small\">\r\n    <div class=\"modal-head\"><h2>暂停</h2><button class=\"x\" data-close=\"menuModal\">✕</button></div>\r\n    <div class=\"menu-list\">\r\n      <button id=\"resumeBtn\"><span>▶</span><b>继续对局</b><small>回到球桌</small></button>\r\n      <button id=\"menuNew\"><span>↻</span><b>重新开局</b><small>当前比分将清空</small></button>\r\n      <button id=\"menuSettings\"><span>⚙</span><b>设置</b><small>模式、对手与 API</small></button>\r\n      <button id=\"menuRules\"><span>?</span><b>玩法说明</b><small>八球与斯诺克规则</small></button>\r\n      <button id=\"menuReplay\" hidden><span>▶</span><b>回放</b><small>最近的对局</small></button>\r\n      <button id=\"menuTerm\" hidden><span>$</span><b>开发者终端</b><small>$shell · #root</small></button>\r\n    </div>\r\n  </div>\r\n</div>\r\n\r\n<!-- 设置 -->\r\n<div class=\"overlay\" id=\"settingsModal\">\r\n  <div class=\"modal settings\">\r\n    <div class=\"modal-head settings-head\">\r\n      <div class=\"settings-title\"><div class=\"eyebrow\">SETTINGS</div><h2>设置</h2></div>\r\n      <div class=\"settings-tabs\" id=\"settingsTabs\">\r\n        <button data-tab=\"match\" class=\"active\">对局</button>\r\n        <button data-tab=\"api\">大模型</button>\r\n      </div>\r\n      <button class=\"x\" data-close=\"settingsModal\">✕</button>\r\n    </div>\r\n    <div class=\"settings-scroll\">\r\n      <section data-pane=\"match\">\r\n        <h3>对局</h3>\r\n        <div class=\"field-row\">\r\n          <label class=\"field\"><span>玩法模式</span>\r\n            <select id=\"setMode\"><option value=\"8ball\">经典八球</option><option value=\"9ball\">九球</option><option value=\"10ball\">十球</option><option value=\"rotation\">轮转追分</option><option value=\"snooker\">斯诺克（简化）</option><option value=\"snooker6\">6 红球斯诺克</option></select>\r\n          </label>\r\n          <label class=\"field\"><span>对手</span>\r\n            <select id=\"setOpponent\"><option value=\"local\">本地 AI</option><option value=\"api\">大模型 API</option><option value=\"human\">双人同机</option><option value=\"lan\">局域网联机</option></select>\r\n          </label>\r\n        </div>\r\n        <div class=\"field-row\">\r\n          <label class=\"field\"><span>AI 难度</span>\r\n            <select id=\"setDifficulty\"><option value=\"easy\">休闲</option><option value=\"normal\">标准</option><option value=\"master\">大师</option></select>\r\n          </label>\r\n          <div class=\"field sws\">\r\n            <span>辅助</span>\r\n            <label class=\"sw\"><input type=\"checkbox\" id=\"setAim\"><i></i><em>瞄准线</em></label>\r\n            <label class=\"sw\"><input type=\"checkbox\" id=\"setSound\"><i></i><em>音效</em></label>\r\n            <label class=\"sw\"><input type=\"checkbox\" id=\"setFreeBallLocal\"><i></i><em>自由球本地</em></label>\r\n            <label class=\"sw\"><input type=\"checkbox\" id=\"setSandboxEnabled\"><i></i><em>沙箱推演</em></label>\r\n            <label class=\"field-inline\"><em>推演上限</em><input type=\"number\" id=\"setSandboxLimit\" min=\"0\" max=\"10\" placeholder=\"跟随难度\"></label>\r\n          </div>\r\n        </div>\r\n      </section>\r\n\r\n      <section class=\"api-section\" data-pane=\"api\">\r\n        <h3>大模型对手 <span>OpenAI 兼容 / Anthropic</span></h3>\r\n        <div id=\"apiFields\">\r\n          <div class=\"ai-profile-bar\">\r\n            <label>AI 配置 <select id=\"aiProfileSelect\"></select></label>\r\n            <button type=\"button\" id=\"aiProfileAdd\">新增</button>\r\n            <button type=\"button\" id=\"aiProfileDel\">删除</button>\r\n          </div>\r\n          <label class=\"field\"><span>显示名称</span><input id=\"setAiName\" type=\"text\" autocomplete=\"off\" spellcheck=\"false\" placeholder=\"AI 1\"></label>\r\n          <div class=\"field-row\">\r\n            <label class=\"field\"><span>服务商</span>\r\n              <select id=\"setProvider\"></select>\r\n            </label>\r\n            <label class=\"field\"><span>协议</span>\r\n              <select id=\"setProtocol\"><option value=\"openai\">OpenAI 兼容</option></select>\n            </label>\r\n          </div>\r\n          <label class=\"field\"><span>Base URL</span><input id=\"setBase\" type=\"url\" autocomplete=\"off\" spellcheck=\"false\" readonly placeholder=\"https://api.deepseek.com/v1\"></label>\n          <p class=\"filed-note\">只能使用已完成 ICP 备案的国内接口。填其他域名会被拦截，并提示「小黑盒小程序不兼容无备案的域名，无法操作」。</p>\n          <div class=\"field-row api-model-row\">\r\n            <label class=\"field\"><span>模型</span><input id=\"setModel\" type=\"text\" autocomplete=\"off\" spellcheck=\"false\" placeholder=\"deepseek-v4-flash\" list=\"modelOptions\"><datalist id=\"modelOptions\"></datalist><div class=\"chips\" id=\"modelChips\"></div></label>\r\n          <label class=\"field\"><span>回放思考翻译模型</span><select id=\"setTranslateAi\"></select></label>\r\n            <label class=\"field\"><span>API Key</span><div class=\"key-wrap\"><input id=\"setKey\" type=\"password\" autocomplete=\"off\" spellcheck=\"false\" placeholder=\"sk-…\"><button type=\"button\" id=\"toggleKey\">显示</button></div></label>\r\n          </div>\r\n          <div class=\"api-actions\">\r\n            <button id=\"fetchModels\">拉取模型</button>\r\n            <button id=\"testApi\">测试连接</button>\r\n            <span id=\"apiStatus\">Key 仅保存在本机</span>\r\n          </div>\r\n        </div>\r\n      </section>\r\n      <section class=\"about\">\r\n        <h3>关于</h3>\r\n        <div class=\"about-row\">\r\n          <span>一杆清台</span>\r\n          <button type=\"button\" id=\"versionTap\" title=\"连续点击 7 次开启开发者模式\">v1.4.22</button>\r\n          <span id=\"devState\">开发者模式未开启</span>\r\n        </div>\r\n        <button type=\"button\" id=\"devOpenTerm\" class=\"ghost dev-open\" hidden>打开 $shell</button>\r\n      </section>\r\n      <p class=\"fineprint\">修改模式或对手后，保存会开始新的一局。大模型只负责从合法候选中选杆，几何计算由本地引擎完成。</p>\r\n    </div>\r\n    <div class=\"modal-actions\">\r\n      <button class=\"ghost\" id=\"settingsHome\">返回主页</button>\r\n      <button class=\"ghost\" data-close=\"settingsModal\">取消</button>\r\n      <button class=\"primary\" id=\"saveSettings\">保存并开局</button>\r\n    </div>\r\n  </div>\r\n</div>\r\n\r\n<!-- 规则 -->\r\n<div class=\"overlay\" id=\"rulesModal\">\r\n  <div class=\"modal rules\">\r\n    <div class=\"modal-head\"><h2>玩法说明</h2><button class=\"x\" data-close=\"rulesModal\">✕</button></div>\r\n    <div class=\"rules-scroll\">\r\n      <h3>经典八球</h3>\r\n      <p>开球后球桌为开放状态，第一颗合法入袋的球决定你的组别：全色（1–7）或花色（9–15）。清完本组后打进黑八获胜。提前打进黑八、打黑八时白球落袋、或先碰到对方的球，都会判负或犯规。</p>\r\n      <h3>九球</h3>\r\n      <p>按 1 到 9 的顺序，每一杆必须先碰台面上号码最小的球。任何球入袋都可以继续击球；9 号球在任何合法击球中入袋即获胜。犯规后对手获得自由球。</p>\r\n      <h3>轮转追分</h3>\r\n      <p>15 颗球，每杆必须先碰号码最小的球，但可以打进任意球并得到该球号码的分数。先到 61 分获胜；如果球全部打完还没到 61 分，分高者胜。</p>\r\n      <h3>斯诺克</h3>\r\n      <p>红球 1 分，黄 2、绿 3、咖啡 4、蓝 5、粉 6、黑 7。红球与彩球交替击打；还有红球时彩球入袋会重摆。红球清完后按分值从低到高打彩球。犯规会送给对手至少 4 分。</p>\r\n      <h3>操作</h3>\r\n      <p>在桌面上拖动瞄准。右侧竖杆：向下滑动蓄力，松手击球，滑动越长力度越大。杆上方的旋钮上下滑动可微调角度，↺ 归零。力度完全由下滑距离决定，不显示数字；AI 回合、球滚动或自由球未摆放时球杆区会禁用。犯规后获得自由球，拖动白球到合法位置即可。开启辅助线会显示假想球、目标球去向、白球撞击后约 3cm 的青色偏转参考线，以及库边反射。斯诺克中当前可打的球会有金色标记。</p>\r\n      <h3>局域网联机</h3>\r\n      <p>同一 Wi-Fi 下，一方“开服”后把屏幕上的 IP:端口 告诉另一方，另一方“加入”。房主先手，双方各自在手机上看到同一张球桌；房主负责物理与规则判定。</p>\r\n      <h3>对手</h3>\r\n      <p>本地 AI 会枚举所有“目标球 × 袋口”组合，检查遮挡、切球角度和走位风险，再按难度加入误差。接入大模型时，本地引擎先把合法候选算好，模型只做战术选择。</p>\r\n    </div>\r\n    <div class=\"modal-actions\"><button class=\"primary\" data-close=\"rulesModal\">知道了</button></div>\r\n  </div>\r\n</div>\r\n\r\n<!-- 结算 -->\r\n<div class=\"overlay\" id=\"overModal\">\r\n  <div class=\"modal over\">\r\n    <div class=\"over-emblem\" id=\"overEmblem\">🏆</div>\r\n    <div class=\"eyebrow\" id=\"overEyebrow\">FRAME OVER</div>\r\n    <h2 id=\"overTitle\">你赢了</h2>\r\n    <p id=\"overSub\">清台成功</p>\r\n    <div class=\"over-score\" id=\"overScore\"></div>\r\n    <p class=\"over-replay-tip\" id=\"overReplayTip\">回放只保留在本次打开期间，想留存请点「回放」→「保存加密存档」</p>\r\n    <div class=\"modal-actions\">\r\n      <button class=\"ghost\" id=\"overReplay\">回放</button>\r\n      <button class=\"ghost\" id=\"overMenu\">返回菜单</button>\r\n      <button class=\"primary\" id=\"overAgain\">再来一局</button>\r\n    </div>\r\n  </div>\r\n</div>\r\n\r\n<!-- 局域网联机 -->\r\n<div class=\"overlay\" id=\"lanModal\">\r\n  <div class=\"modal lan\">\r\n    <div class=\"modal-head\">\r\n      <div><div class=\"eyebrow\">LAN PLAY</div><h2>局域网联机</h2></div>\r\n      <button class=\"x\" data-close=\"lanModal\">✕</button>\r\n    </div>\r\n    <div class=\"lan-tabs\" id=\"lanTabs\">\r\n      <button data-lan-tab=\"host\" class=\"active\">开服</button>\r\n      <button data-lan-tab=\"join\">加入</button>\r\n    </div>\r\n    <label class=\"lan-web-toggle\"><input type=\"checkbox\" id=\"lanWebMode\"><i></i><span>跨端联机（网页 / APK，PeerJS 配对码）</span></label>\r\n    <div class=\"lan-scroll\">\r\n      <section data-lan-pane=\"host\">\r\n        <p class=\"lan-lead\">同一 Wi-Fi 下开一个房间，朋友输入地址加入。房主先手。</p>\r\n        <div class=\"field-row lan-start-row\" id=\"lanPortRow\">\r\n          <label class=\"field\"><span>端口</span><input id=\"lanPort\" type=\"number\" inputmode=\"numeric\" value=\"8765\" min=\"1024\" max=\"65535\"></label>\r\n          <button id=\"lanHostBtn\" class=\"primary\">开启服务器</button>\r\n        </div>\r\n        <div id=\"lanWebHostRow\" hidden><button id=\"lanWebHostBtn\" class=\"primary\">生成配对码</button></div>\r\n        <div class=\"lan-status\" id=\"lanHostStatus\">未开启</div>\r\n        <div class=\"lan-address\" id=\"lanAddress\">—</div>\r\n        <p class=\"lan-note\">把上面的地址告诉朋友；需要同一局域网，且手机未被防火墙隔离。</p>\r\n      </section>\r\n      <section data-lan-pane=\"join\" hidden>\r\n        <p class=\"lan-lead\">输入房主屏幕上显示的地址。</p>\r\n        <label class=\"field\"><span id=\"lanJoinLabel\">主机地址</span><input id=\"lanJoinAddr\" placeholder=\"192.168.1.10:8765\" autocomplete=\"off\" spellcheck=\"false\"></label>\r\n        <label class=\"field\"><span>你的名字</span><input id=\"lanJoinName\" value=\"远程玩家\" maxlength=\"12\" autocomplete=\"off\"></label>\r\n        <button id=\"lanJoinBtn\" class=\"primary\">连接服务器</button>\r\n        <div class=\"lan-status\" id=\"lanJoinStatus\">未连接</div>\r\n        <p class=\"lan-note\">房主收到连接后会开始对局；连接失败请检查 IP、端口和 Wi-Fi。</p>\r\n      </section>\r\n    </div>\r\n    <div class=\"modal-actions\">\r\n      <button class=\"ghost\" id=\"lanHostNew\" hidden>重新开局</button>\r\n      <button class=\"ghost\" id=\"lanLeave\" hidden>断开联机</button>\r\n      <button class=\"ghost\" data-close=\"lanModal\">关闭</button>\r\n    </div>\r\n  </div>\r\n</div>\r\n\r\n<!-- 导出选项 -->\r\n<div class=\"overlay\" id=\"exportModal\">\r\n  <div class=\"modal export-modal\">\r\n    <div class=\"modal-head\">\r\n      <div><div class=\"eyebrow\">EXPORT</div><h2>导出回放</h2></div>\r\n      <button class=\"x\" data-close=\"exportModal\">✕</button>\r\n    </div>\r\n    <div class=\"export-scroll\">\r\n      <p class=\"lan-lead\">对局过程必选，其余按需导出。</p>\r\n      <label class=\"export-check\"><input type=\"checkbox\" checked disabled><span><b>对局过程</b><small>球局、击球、比分、胜负</small></span></label>\r\n      <label class=\"export-check\"><input type=\"checkbox\" id=\"exportSandbox\" checked><span><b>模型沙箱</b><small>沙箱推演和桌台片段</small></span></label>\r\n      <label class=\"export-check\"><input type=\"checkbox\" id=\"exportThinking\" checked><span><b>模型思考</b><small>模型返回的 reasoning / thinking 片段</small></span></label>\r\n      <label class=\"export-check\"><input type=\"checkbox\" id=\"exportApi\" checked><span><b>模型调用详情</b><small>请求、响应、输出、token 用量；不含 API Key</small></span></label>\r\n      <label class=\"export-check\"><input type=\"checkbox\" id=\"exportFrames\" checked><span><b>逐帧球位</b><small>关闭后文件更小，但回放不能逐帧移动</small></span></label>\r\n      <!-- 【为什么单独一个勾选项】加密存档要连沙箱/思考/API 一起留才完整，文件很大；只存关键帧能把体积压到零头，导入时插值还原 -->\r\n      <label class=\"export-check\"><input type=\"checkbox\" id=\"archiveCompact\"><span><b>紧凑加密存档</b><small>只存关键帧，导入后插值还原；完整沙箱/思考/API 仍保留</small></span></label>\r\n    </div>\r\n    <div class=\"modal-actions\">\r\n      <button class=\"ghost\" data-close=\"exportModal\">取消</button>\r\n      <button class=\"ghost\" id=\"archiveImport\">导入存档</button>\r\n      <button class=\"ghost\" id=\"archiveSave\">保存加密存档</button>\r\n      <button class=\"primary\" id=\"exportGo\">导出 JSON</button>\r\n    </div>\r\n  </div>\r\n</div>\r\n\r\n<!-- 加密存档的密码输入 -->\r\n<div class=\"overlay\" id=\"passwordModal\">\r\n  <div class=\"modal password-modal\">\r\n    <div class=\"modal-head\"><div><div class=\"eyebrow\">ARCHIVE</div><h2 id=\"passwordTitle\">存档密码</h2></div><button class=\"x\" id=\"passwordCancel2\">✕</button></div>\r\n    <div class=\"password-body\">\r\n      <p class=\"password-desc\" id=\"passwordDesc\">设置一个密码。</p>\r\n      <input type=\"password\" id=\"passwordInput\" autocomplete=\"off\" placeholder=\"密码\">\r\n    </div>\r\n    <div class=\"modal-actions\">\r\n      <button class=\"ghost\" id=\"passwordCancel\">取消</button>\r\n      <button class=\"primary\" id=\"passwordOk\">确定</button>\r\n    </div>\r\n  </div>\r\n</div>\r\n\r\n<!-- 开发者终端 -->\r\n<div class=\"overlay\" id=\"terminalModal\">\r\n  <div class=\"modal terminal\">\r\n    <div class=\"term-head\">\r\n      <div class=\"term-titlebar\">\r\n        <span class=\"term-app\">LOCAL</span>\r\n        <h2><span id=\"termTitle\">$shell</span></h2>\r\n        <span class=\"term-session\">pts/0</span>\r\n      </div>\r\n      <button class=\"x\" data-close=\"terminalModal\">✕</button>\r\n    </div>\r\n    <div class=\"term-log\" id=\"termLog\"></div>\r\n    <div class=\"term-toolbar\" id=\"termToolbar\">\r\n      <button data-term-key=\"tab\">TAB</button>\r\n      <button data-term-key=\"up\">↑</button>\r\n      <button data-term-key=\"down\">↓</button>\r\n      <button data-term-key=\"left\">←</button>\r\n      <button data-term-key=\"right\">→</button>\r\n      <button data-term-key=\"clear\">CLR</button>\r\n      <span class=\"term-meta\">UTF-8</span>\r\n    </div>\r\n    <div class=\"term-row\">\r\n      <span class=\"term-prompt\" id=\"termPrompt\">$</span>\r\n      <input id=\"termInput\" autocomplete=\"off\" spellcheck=\"false\" autocapitalize=\"off\" placeholder=\"输入 help\">\r\n      <button id=\"termRun\">↵</button>\r\n    </div>\r\n    <div class=\"term-hint\" id=\"termHint\">开发者模式 · 输入 #root 获取更高权限</div>\r\n  </div>\r\n</div>\r\n\r\n<!-- 回放 -->\r\n<div class=\"replay-overlay\" id=\"replayModal\">\r\n  <div class=\"replay-top\">\r\n    <div class=\"replay-brand\">\r\n      <span class=\"replay-kicker\">REPLAY</span>\r\n      <b id=\"replayTitle\">对局回放</b>\r\n      <select id=\"replaySelect\"></select>\r\n    </div>\r\n    <div class=\"replay-modes\">\r\n      <button data-rmode=\"match\" class=\"active\">对局</button>\r\n      <button data-rmode=\"thinking\">对局+沙箱</button>\r\n    </div>\r\n    <button id=\"replayGuide\" class=\"active\" title=\"显示击球辅助线\">辅助线</button>\r\n    <button id=\"replayExport\">导出 JSON</button>\r\n    <button class=\"x replay-x\" id=\"replayClose\">✕</button>\r\n  </div>\r\n  <div class=\"replay-caption\" id=\"replayCaption\"></div>\r\n  <div class=\"replay-transparent\"></div>\r\n  <div class=\"replay-think-prompt\" id=\"replayThinkPrompt\" hidden>\r\n    <b>检测到模型思考片段</b>\r\n    <p id=\"replayThinkPromptText\">是否在空白处显示？</p>\r\n    <div>\r\n      <button id=\"replayThinkShow\">显示思考</button>\r\n      <button id=\"replayThinkTranslate\" hidden>先翻译思考片段</button>\r\n      <button id=\"replayThinkHide\">不显示</button>\r\n    </div>\r\n  </div>\r\n  <div class=\"replay-think-panel\" id=\"replayThinkPanel\" hidden>\r\n    <div class=\"rtp-head\"><b id=\"replayThinkTitle\">模型思考</b><span id=\"replayThinkMeta\"></span><button id=\"replayThinkClose\">✕</button></div>\r\n    <div class=\"rtp-body\" id=\"replayThinkBody\"></div>\r\n  </div>\r\n  <div class=\"replay-panel\">\r\n    <div class=\"replay-controls\">\r\n      <button id=\"replayPrev\">◀</button>\r\n      <button id=\"replayPlay\">▶</button>\r\n      <button id=\"replayNext\">▶|</button>\r\n      <input type=\"range\" id=\"replayRange\" min=\"0\" max=\"0\" value=\"0\">\r\n      <span id=\"replayCounter\">0 / 0</span>\r\n    </div>\r\n    <div class=\"replay-body\">\r\n      <div class=\"replay-info\" id=\"replayInfo\"></div>\r\n      <div class=\"replay-trace\" id=\"replayTrace\"></div>\r\n    </div>\r\n  </div>\r\n</div>\r\n\r\n<div class=\"toast\" id=\"toast\"></div>\r\n</div>\r\n";
/* ---------------- 设置：云端 1 个 value ---------------- */

const PREFS_SCOPE = 'pool';
const PREFS_SAVE_DEBOUNCE = 700;

/** 把云端读到的设置交给 game.js；它会在下一帧重新吃一遍 */
function applyPrefs(json) {
  try {
    window.__poolPrefs = typeof json === 'string' ? json : JSON.stringify(json || {});
    if (typeof window.__poolReloadSettings === 'function') window.__poolReloadSettings();
  } catch (e) { /* ignore */ }
}

/**
 * 读云端设置。
 * 【为什么失败也要放行】读不到（首次进入 / 网络差 / 云端为空）时游戏必须能玩，
 *   只是全部回落到默认值。把读取失败当成致命错误会让用户连球桌都看不到。
 */
async function loadPrefsIntoGlobals() {
  try {
    const data = await readScope(PREFS_SCOPE);
    if (data && typeof data === 'object') applyPrefs(data);
  } catch (e) { /* 读不到就用默认值 */ }
  return true;
}

/**
 * game.js 每次设置变动都会调它（同步、高频）。
 * 【为什么要防抖】saveSettings 在出杆、切模式、拖音量时都会被调，
 *   不合并的话每拖动一次就写一次云端，既卡又容易撞限流。
 *   合并到 700ms 内只写最后一次，用户松手后很快就落盘。
 */
let prefsTimer = null;
let prefsPending = null;
window.__poolSavePrefs = (json) => {
  prefsPending = json;
  if (prefsTimer) clearTimeout(prefsTimer);
  prefsTimer = setTimeout(async () => {
    prefsTimer = null;
    const payload = prefsPending;
    prefsPending = null;
    if (!payload) return;
    try {
      let obj = {};
      try { obj = JSON.parse(payload); } catch (e) { return; }
      const res = await writeScope(PREFS_SCOPE, obj);
      if (!res.ok && res.error === 'TOO_LARGE') {
        console.warn('[pool] 设置超出云端容量', res.bytes, '/', res.capacity);
      }
    } catch (e) { /* 写失败不打断游戏 */ }
  }, PREFS_SAVE_DEBOUNCE);
};

/**
 * 挂载球桌。
 *
 * 【为什么不再有 onExit】用户明确要求完整版不要退出按钮。
 *   小程序里没有 API 能关掉宿主（SDK 里查过，没有 exit / close 一类），
 *   所以「退出」根本无处可去，留按钮是假的。
 *
 * 【为什么要挡重复挂载】模板 id 是固定的，挂两次会得到两套
 *   pointerdown 监听和两个 raf 循环，球的物理会互相打架。
 */
export function mountPool(container) {
  const existing = document.querySelector('.pool-root');
  if (existing) return { root: existing, pause() {}, resume() {} };

  const root = h('div', { class: 'pool-root' });
  root.innerHTML = TEMPLATE;
  container.appendChild(root);

  /* 【完整版的设置只占 1 个云端 value】用户要求「完整版用 1 个 value 存储
     api、设置等」。这里用 save.js 的 pool 域（save_44，16 KB）读写。
     【为什么要在 boot 之前把设置塞进去】game.js 在模块顶层就执行了
     `const S = loadSettings()`，那一步读完设置就固定下来了；
     等 boot() 再补就晚了——欢迎页上的模式、对手、难度已经按默认值渲染过。
     所以必须在 import('./game.js') 之前把 __poolPrefs 准备好。
     【代价】game.js 是静态 import，模块求值早于本函数体。
     因此改成：先同步放一个占位，等云端读回来后再调 reloadSettings()
     让 game.js 重新吃一遍设置。 */
  const prefsReady = loadPrefsIntoGlobals();

  /**
   * 结算回调。
   * 【为什么要挂 window 而不是直接传参】game.js 是 IIFE，内部拿不到这一层的作用域。
   *   它结算时会调 window.__poolOnOver，这里接住，记分并提交总分榜。
   */
  window.__poolOnOver = (result) => {
    if (!result) return;
    // 【为什么只记玩家 0 的分数】同机双人 / 人机对战，座位 1 可能是 AI。
    //   AI 的成绩没有意义，也不该进榜。
    const score = computeRunScore({
      mode: result.mode,
      winner: result.winner,
      difficulty: result.difficulty,
      shotIndex: result.shots,
      ballsTotal: result.ballsTotal,
    });
    recordBest('yigan', result.mode, score).catch(() => {});
    submitTotalScore({ extra: accountForBoard(), modded: false }).catch(() => {});
  };

  /**
   * 暂停 / 恢复。
   * 【为什么要暴露出去】启动器要把它们接到 window.appPause / appResume 上，
   *   否则切后台后 game.js 的 raf 和 AI 定时器还在跑，回来就是两套在算。
   */
  const handle = {
    root,
    // 【为什么调 appPause 而不是自定义名字】game.js 里本来就定义了
    //   window.appPause / appResume（停 raf、清 AI 定时器、重量画布），
    //   再造一套只会两处不同步。
    pause() { try { window.appPause && window.appPause(); } catch (e) { /* ignore */ } },
    resume() { try { window.appResume && window.appResume(); } catch (e) { /* ignore */ } },
  };

  // 【为什么延一帧再启动】root 刚插进 DOM，尺寸可能还是 0，
  //   这时 resizeCanvas() 量到的尺寸是错的，球桌会画成一条线。
  // 【为什么是 __poolBoot 而不是等 load】game.js 已改成不自动启动
  //   （导入那一刻模板还不在 DOM 里），由这里显式叫醒。
  requestAnimationFrame(() => {
    try { window.__poolBoot && window.__poolBoot(); } catch (e) { console.error('[pool] boot failed', e); }
  });

  return handle;
}