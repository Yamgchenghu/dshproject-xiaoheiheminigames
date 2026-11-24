/**
 * 一个够用的 Python 子集解释器。
 *
 * 【为什么要自己写】小程序沙箱里不能跑 CPython，也没有 WASM 版解释器的
 *   体积预算（Pyodide 起步 6MB，整个小程序才几 MB）。而模组脚本需要的
 *   只是"能表达逻辑"的一小撮语法：变量、算术、条件、循环、函数、类、import。
 *   写一个 800 行的子集，比塞一个 6MB 的运行时更合适。
 *
 * 【支持范围】
 *   语句：赋值 / 增量赋值 / if-elif-else / while / for-in / break / continue /
 *         def / return / class / import / from-import / pass / print / del
 *   表达式：数字、字符串、f-string、列表、字典、元组、布尔、None、
 *           算术 + - * / // % **、比较 == != < <= > >=、and/or/not/in、
 *           下标、属性、调用、lambda
 *   内置：print len range str int float bool list dict abs min max sum round
 *         sorted enumerate zip type isinstance
 *   模块：random（random/randint/choice/uniform/shuffle/seed）、
 *         time（time/sleep/monotonic）
 *
 * 【不支持】生成器、装饰器、with、异常（try/except 只做语法接受并跳过）、
 *   多继承、元类、async。模组脚本用不到，实现了也是负担。
 *
 * 【执行模型】解释器是"可暂停的"：每次 runStep() 执行有限步就返回，
 *   由驱动方决定什么时候继续。这样 time.sleep 不会阻塞 UI，
 *   暂停/停止也能在一个步进边界上立刻生效。
 */

// ---------------- 词法 ----------------

const KEYWORDS = new Set([
  'and', 'as', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else',
  'False', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
  'None', 'not', 'or', 'pass', 'return', 'True', 'try', 'except', 'finally',
  'while', 'with', 'yield', 'raise',
]);

const OPS = [
  '**=', '//=', '<<=', '>>=',
  '==', '!=', '<=', '>=', '**', '//', '+=', '-=', '*=', '/=', '%=',
  '->', ':=',
  '+', '-', '*', '/', '%', '<', '>', '=', '(', ')', '[', ']', '{', '}',
  ',', ':', '.', ';',
];

export class PyError extends Error {
  constructor(message, line) {
    super(line ? `第 ${line} 行：${message}` : message);
    this.name = 'PyError';
    this.line = line;
  }
}

function tokenize(src) {
  const tokens = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const indents = [0];
  let depth = 0; // 括号深度：括号内的换行不产生 NEWLINE/INDENT

  for (let ln = 0; ln < lines.length; ln++) {
    let line = lines[ln];
    const lineNo = ln + 1;

    // 去掉注释（字符串内的 # 要保留，所以走状态机）
    line = stripComment(line);
    if (!line.trim() && depth === 0) continue;

    // 行首缩进
    if (depth === 0) {
      const m = line.match(/^[ \t]*/);
      const raw = m[0].replace(/\t/g, '    ');
      const indent = raw.length;
      if (line.trim()) {
        if (indent > indents[indents.length - 1]) {
          indents.push(indent);
          tokens.push({ type: 'INDENT', line: lineNo });
        } else {
          while (indent < indents[indents.length - 1]) {
            indents.pop();
            tokens.push({ type: 'DEDENT', line: lineNo });
          }
          if (indent !== indents[indents.length - 1]) {
            throw new PyError('缩进不一致', lineNo);
          }
        }
      }
      line = line.slice(m[0].length);
    }

    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === ' ' || ch === '\t') {
        i++;
        continue;
      }
      // 字符串（含前缀 f / r / b）
      let prefix = '';
      let j = i;
      while (j < line.length && /[fFrRbBuU]/.test(line[j]) && j - i < 2) {
        prefix += line[j];
        j++;
      }
      if (line[j] === '"' || line[j] === "'") {
        const quote = line[j];
        const triple = line.slice(j, j + 3) === quote.repeat(3);
        const start = j + (triple ? 3 : 1);
        let k = start;
        let value = '';
        while (k < line.length) {
          if (triple) {
            if (line.slice(k, k + 3) === quote.repeat(3)) break;
          } else if (line[k] === quote) break;
          if (line[k] === '\\' && k + 1 < line.length) {
            value += unescape(line[k + 1]);
            k += 2;
            continue;
          }
          value += line[k];
          k++;
        }
        const end = k + (triple ? 3 : 1);
        tokens.push({ type: 'STRING', value, fstring: /f/i.test(prefix), line: lineNo });
        i = end;
        continue;
      }

      // 数字
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(line[i + 1] || ''))) {
        const m = line.slice(i).match(/^(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d*\.?\d+(?:[eE][+-]?\d+)?)/);
        if (m) {
          const raw = m[0];
          const value = /^0[xX]/.test(raw) ? parseInt(raw, 16)
            : /^0[bB]/.test(raw) ? parseInt(raw.slice(2), 2)
            : /^0[oO]/.test(raw) ? parseInt(raw.slice(2), 8)
            : Number(raw);
          tokens.push({ type: 'NUMBER', value, line: lineNo });
          i += raw.length;
          continue;
        }
      }

      // 标识符 / 关键字
      if (/[A-Za-z_\u4e00-\u9fa5]/.test(ch)) {
        const m = line.slice(i).match(/^[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5]*/);
        const word = m[0];
        tokens.push({
          type: KEYWORDS.has(word) ? 'KW' : 'NAME',
          value: word,
          line: lineNo,
        });
        i += word.length;
        continue;
      }

      // 运算符
      let matched = null;
      for (const op of OPS) {
        if (line.startsWith(op, i)) {
          matched = op;
          break;
        }
      }
      if (matched) {
        if (matched === '(' || matched === '[' || matched === '{') depth++;
        if (matched === ')' || matched === ']' || matched === '}') depth--;
        tokens.push({ type: 'OP', value: matched, line: lineNo });
        i += matched.length;
        continue;
      }

      throw new PyError(`无法识别的字符 "${ch}"`, lineNo);
    }
    if (depth === 0) tokens.push({ type: 'NEWLINE', line: lineNo });
  }
  while (indents.length > 1) {
    indents.pop();
    tokens.push({ type: 'DEDENT', line: lines.length });
  }
  tokens.push({ type: 'EOF', line: lines.length });
  return tokens;
}

function stripComment(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += line[i + 1] || '';
        i++;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '#') break;
    out += ch;
  }
  return out;
}

function unescape(c) {
  return { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '0': '\0' }[c] || c;
}

// ---------------- 语法 ----------------

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset] || this.tokens[this.tokens.length - 1];
  }

  next() {
    return this.tokens[this.pos++];
  }

  is(type, value) {
    const t = this.peek();
    return t.type === type && (value === undefined || t.value === value);
  }

  eat(type, value) {
    if (this.is(type, value)) return this.next();
    return null;
  }

  expect(type, value) {
    const t = this.peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new PyError(`期望 ${value || type}，实际是 ${t.value ?? t.type}`, t.line);
    }
    return this.next();
  }

  skipNewlines() {
    while (this.is('NEWLINE')) this.next();
  }

  parseProgram() {
    const body = [];
    this.skipNewlines();
    while (!this.is('EOF')) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    return { type: 'Program', body };
  }

  parseBlock() {
    this.expect('OP', ':');
    this.skipNewlines();
    this.expect('INDENT');
    const body = [];
    this.skipNewlines();
    while (!this.is('DEDENT') && !this.is('EOF')) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    this.eat('DEDENT');
    return body;
  }

  parseStatement() {
    const t = this.peek();
    const line = t.line;

    if (t.type === 'KW') {
      switch (t.value) {
        case 'if': return this.parseIf();
        case 'while': return this.parseWhile();
        case 'for': return this.parseFor();
        case 'def': return this.parseDef();
        case 'class': return this.parseClass();
        case 'return': {
          this.next();
          let value = null;
          if (!this.is('NEWLINE') && !this.is('DEDENT') && !this.is('EOF')) value = this.parseExpr();
          return { type: 'Return', value, line };
        }
        case 'break': this.next(); return { type: 'Break', line };
        case 'continue': this.next(); return { type: 'Continue', line };
        case 'pass': this.next(); return { type: 'Pass', line };
        case 'import': return this.parseImport();
        case 'from': return this.parseFromImport();
        case 'del': {
          this.next();
          const target = this.parseExpr();
          return { type: 'Del', target, line };
        }
        case 'global': {
          this.next();
          const names = [this.expect('NAME').value];
          while (this.eat('OP', ',')) names.push(this.expect('NAME').value);
          return { type: 'Global', names, line };
        }
        case 'try': return this.parseTry();
        case 'raise': {
          this.next();
          const value = this.is('NEWLINE') ? null : this.parseExpr();
          return { type: 'Raise', value, line };
        }
        case 'with': {
          // 只做语法接受：解析完整个 with 块并执行它（语义上等同顺序执行）
          this.next();
          const items = [this.parseExpr()];
          while (this.eat('OP', ',')) items.push(this.parseExpr());
          const body = this.parseBlock();
          return { type: 'With', items, body, line };
        }
      }
    }

    const expr = this.parseExprList();
    // 赋值
    if (this.is('OP', '=')) {
      this.next();
      const value = this.parseExprList();
      return { type: 'Assign', target: expr, value, line };
    }
    for (const op of ['+=', '-=', '*=', '/=', '//=', '%=', '**=']) {
      if (this.is('OP', op)) {
        this.next();
        const value = this.parseExprList();
        return { type: 'AugAssign', target: expr, op: op.slice(0, -1), value, line };
      }
    }
    return { type: 'Expr', value: expr, line };
  }

  parseIf() {
    const line = this.next().line;
    const test = this.parseExpr();
    const body = this.parseBlock();
    let orelse = null;
    if (this.is('KW', 'elif')) {
      orelse = [this.parseIf()];
    } else if (this.is('KW', 'else')) {
      this.next();
      orelse = this.parseBlock();
    }
    return { type: 'If', test, body, orelse, line };
  }

  parseWhile() {
    const line = this.next().line;
    const test = this.parseExpr();
    const body = this.parseBlock();
    return { type: 'While', test, body, line };
  }

  parseFor() {
    const line = this.next().line;
    const target = this.parseTargetList();
    this.expect('KW', 'in');
    const iter = this.parseExpr();
    const body = this.parseBlock();
    return { type: 'For', target, iter, body, line };
  }

  parseTargetList() {
    const first = this.parseTarget();
    if (!this.is('OP', ',')) return first;
    const targets = [first];
    while (this.eat('OP', ',')) {
      if (this.is('KW', 'in') || this.is('OP', ')')) break;
      targets.push(this.parseTarget());
    }
    return { type: 'Tuple', items: targets };
  }

  parseTarget() {
    let node = { type: 'Name', name: this.expect('NAME').value };
    for (;;) {
      if (this.is('OP', '.')) {
        this.next();
        node = { type: 'Attr', obj: node, name: this.expect('NAME').value };
      } else if (this.is('OP', '[')) {
        this.next();
        const index = this.parseExpr();
        this.expect('OP', ']');
        node = { type: 'Index', obj: node, index };
      } else break;
    }
    return node;
  }

  parseDef() {
    const line = this.next().line;
    const name = this.expect('NAME').value;
    this.expect('OP', '(');
    const params = [];
    while (!this.is('OP', ')')) {
      if (this.is('OP', '*') || this.is('OP', '**')) this.next();
      const pname = this.expect('NAME').value;
      let def = null;
      if (this.eat('OP', '=')) def = this.parseExpr();
      params.push({ name: pname, def });
      if (!this.eat('OP', ',')) break;
    }
    this.expect('OP', ')');
    if (this.eat('OP', '->')) this.parseExpr();
    const body = this.parseBlock();
    return { type: 'Def', name, params, body, line };
  }

  parseClass() {
    const line = this.next().line;
    const name = this.expect('NAME').value;
    let bases = [];
    if (this.eat('OP', '(')) {
      while (!this.is('OP', ')')) {
        bases.push(this.parseExpr());
        if (!this.eat('OP', ',')) break;
      }
      this.expect('OP', ')');
    }
    const body = this.parseBlock();
    return { type: 'Class', name, bases, body, line };
  }

  parseImport() {
    this.next();
    const names = [];
    do {
      const mod = this.expect('NAME').value;
      let alias = null;
      if (this.is('KW', 'as')) {
        this.next();
        alias = this.expect('NAME').value;
      }
      names.push({ mod, alias });
    } while (this.eat('OP', ','));
    return { type: 'Import', names };
  }

  parseFromImport() {
    this.next();
    const mod = this.expect('NAME').value;
    this.expect('KW', 'import');
    if (this.is('OP', '*')) {
      this.next();
      return { type: 'FromImport', mod, names: [{ name: '*', alias: null }] };
    }
    const names = [];
    do {
      const name = this.expect('NAME').value;
      let alias = null;
      if (this.is('KW', 'as')) {
        this.next();
        alias = this.expect('NAME').value;
      }
      names.push({ name, alias });
    } while (this.eat('OP', ','));
    return { type: 'FromImport', mod, names };
  }

  parseTry() {
    const line = this.next().line;
    const body = this.parseBlock();
    const handlers = [];
    while (this.is('KW', 'except')) {
      this.next();
      let typeName = null;
      let varName = null;
      if (!this.is('OP', ':')) {
        typeName = this.parseExpr();
        if (this.is('KW', 'as')) {
          this.next();
          varName = this.expect('NAME').value;
        }
      }
      const hbody = this.parseBlock();
      handlers.push({ typeName, varName, body: hbody });
    }
    let finalbody = null;
    if (this.is('KW', 'finally')) {
      this.next();
      finalbody = this.parseBlock();
    }
    return { type: 'Try', body, handlers, finalbody, line };
  }

  // ---- 表达式 ----
  parseExprList() {
    const first = this.parseExpr();
    if (!this.is('OP', ',')) return first;
    const items = [first];
    while (this.eat('OP', ',')) {
      if (this.is('NEWLINE') || this.is('OP', '=') || this.is('EOF')) break;
      items.push(this.parseExpr());
    }
    return { type: 'Tuple', items };
  }

  parseExpr() {
    return this.parseTernary();
  }

  parseTernary() {
    const value = this.parseOr();
    if (this.is('KW', 'if')) {
      this.next();
      const test = this.parseOr();
      this.expect('KW', 'else');
      const orelse = this.parseTernary();
      return { type: 'IfExp', test, body: value, orelse };
    }
    return value;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.is('KW', 'or')) {
      this.next();
      left = { type: 'BoolOp', op: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.is('KW', 'and')) {
      this.next();
      left = { type: 'BoolOp', op: 'and', left, right: this.parseNot() };
    }
    return left;
  }

  parseNot() {
    if (this.is('KW', 'not')) {
      this.next();
      return { type: 'UnaryOp', op: 'not', operand: this.parseNot() };
    }
    return this.parseComparison();
  }

  parseComparison() {
    let left = this.parseAdd();
    for (;;) {
      const t = this.peek();
      let op = null;
      if (t.type === 'OP' && ['==', '!=', '<', '<=', '>', '>='].includes(t.value)) op = t.value;
      else if (t.type === 'KW' && t.value === 'in') op = 'in';
      else if (t.type === 'KW' && t.value === 'is') op = 'is';
      else if (t.type === 'KW' && t.value === 'not' && this.peek(1).value === 'in') op = 'not in';
      if (!op) break;
      if (op === 'not in') {
        this.next();
        this.next();
      } else {
        this.next();
        if (op === 'is' && this.is('KW', 'not')) {
          this.next();
          op = 'is not';
        }
      }
      left = { type: 'Compare', op, left, right: this.parseAdd() };
    }
    return left;
  }

  parseAdd() {
    let left = this.parseMul();
    while (this.is('OP', '+') || this.is('OP', '-')) {
      const op = this.next().value;
      left = { type: 'BinOp', op, left, right: this.parseMul() };
    }
    return left;
  }

  parseMul() {
    let left = this.parseUnary();
    while (this.is('OP', '*') || this.is('OP', '/') || this.is('OP', '//') || this.is('OP', '%')) {
      const op = this.next().value;
      left = { type: 'BinOp', op, left, right: this.parseUnary() };
    }
    return left;
  }

  parseUnary() {
    if (this.is('OP', '-')) {
      this.next();
      return { type: 'UnaryOp', op: '-', operand: this.parseUnary() };
    }
    if (this.is('OP', '+')) {
      this.next();
      return this.parseUnary();
    }
    return this.parsePower();
  }

  parsePower() {
    const base = this.parsePostfix();
    if (this.is('OP', '**')) {
      this.next();
      return { type: 'BinOp', op: '**', left: base, right: this.parseUnary() };
    }
    return base;
  }

  parsePostfix() {
    let node = this.parseAtom();
    for (;;) {
      if (this.is('OP', '.')) {
        this.next();
        node = { type: 'Attr', obj: node, name: this.expect('NAME').value };
      } else if (this.is('OP', '(')) {
        this.next();
        const args = [];
        const kwargs = [];
        while (!this.is('OP', ')')) {
          if (this.is('NAME') && this.peek(1).type === 'OP' && this.peek(1).value === '=') {
            const kname = this.next().value;
            this.next();
            kwargs.push({ name: kname, value: this.parseExpr() });
          } else {
            args.push(this.parseExpr());
          }
          if (!this.eat('OP', ',')) break;
        }
        this.expect('OP', ')');
        node = { type: 'Call', func: node, args, kwargs };
      } else if (this.is('OP', '[')) {
        this.next();
        const index = this.parseExpr();
        this.expect('OP', ']');
        node = { type: 'Index', obj: node, index };
      } else break;
    }
    return node;
  }

  parseAtom() {
    const t = this.peek();
    if (t.type === 'NUMBER') {
      this.next();
      return { type: 'Const', value: t.value };
    }
    if (t.type === 'STRING') {
      this.next();
      // 相邻字符串自动拼接（Python 特性）
      let value = t.value;
      let fstring = t.fstring;
      while (this.is('STRING')) {
        const n = this.next();
        value += n.value;
        fstring = fstring || n.fstring;
      }
      return { type: 'Const', value, fstring };
    }
    if (t.type === 'KW') {
      if (t.value === 'True') { this.next(); return { type: 'Const', value: true }; }
      if (t.value === 'False') { this.next(); return { type: 'Const', value: false }; }
      if (t.value === 'None') { this.next(); return { type: 'Const', value: null }; }
      if (t.value === 'lambda') {
        this.next();
        const params = [];
        while (!this.is('OP', ':')) {
          params.push({ name: this.expect('NAME').value, def: null });
          if (!this.eat('OP', ',')) break;
        }
        this.expect('OP', ':');
        const body = this.parseExpr();
        return { type: 'Lambda', params, body };
      }
    }
    if (t.type === 'NAME') {
      this.next();
      return { type: 'Name', name: t.value };
    }
    if (t.type === 'OP') {
      if (t.value === '(') {
        this.next();
        if (this.is('OP', ')')) {
          this.next();
          return { type: 'Tuple', items: [] };
        }
        const first = this.parseExpr();
        if (this.is('OP', ',')) {
          const items = [first];
          while (this.eat('OP', ',')) {
            if (this.is('OP', ')')) break;
            items.push(this.parseExpr());
          }
          this.expect('OP', ')');
          return { type: 'Tuple', items };
        }
        this.expect('OP', ')');
        return first;
      }
      if (t.value === '[') {
        this.next();
        const items = [];
        while (!this.is('OP', ']')) {
          items.push(this.parseExpr());
          if (!this.eat('OP', ',')) break;
        }
        this.expect('OP', ']');
        return { type: 'List', items };
      }
      if (t.value === '{') {
        this.next();
        const entries = [];
        while (!this.is('OP', '}')) {
          const key = this.parseExpr();
          this.expect('OP', ':');
          const value = this.parseExpr();
          entries.push({ key, value });
          if (!this.eat('OP', ',')) break;
        }
        this.expect('OP', '}');
        return { type: 'Dict', entries };
      }
    }
    throw new PyError(`无法解析的表达式 "${t.value ?? t.type}"`, t.line);
  }
}

export function parse(src) {
  return new Parser(tokenize(src)).parseProgram();
}
