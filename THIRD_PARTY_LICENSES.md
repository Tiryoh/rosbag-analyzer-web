# Third-party licenses (bundled components)

This file documents third-party software bundled into optional web builds when
`VITE_ENABLE_LLM=1` is set (SQL console). Release download artifacts built
without that flag do not include these components.

## sql.js

- Project: https://github.com/sql-js/sql.js
- License: MIT (see below)
- Bundled artifact: `sql-wasm.wasm` (SQLite compiled to WebAssembly), loaded by sql.js

```
MIT license

Copyright (c) 2017 sql.js authors (see AUTHORS)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## SQLite (via sql.js WebAssembly build)

- Project: https://www.sqlite.org/
- License: Public domain (no copyright; see https://www.sqlite.org/copyright.html)

SQLite is embedded inside the sql.js `sql-wasm.wasm` binary. SQLite's authors
disclaim copyright to the extent permitted by law and place their contributions
in the public domain.
