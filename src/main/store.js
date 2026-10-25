// Small JSON-file persistence with debounced, atomic writes.
const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(dir, name, defaults) {
    this.file = path.join(dir, `${name}.json`);
    this.timer = null;
    this.data = defaults;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = Array.isArray(defaults) ? raw : { ...defaults, ...raw };
    } catch {
      // first run or unreadable file: keep defaults
    }
  }

  save(delay = 400) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { JsonStore };
