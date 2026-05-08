---
name: lua-vibe
version: 2.0.0
description: Lua best practices, idioms, and ecosystem tooling. Use when writing or refactoring Lua code; designing modules; choosing between locals, tables, and metatables; handling errors with pcall/xpcall/assert; building OOP via __index; tuning performance for LuaJIT; setting up LuaRocks, busted tests, lua-language-server, stylua, luacheck, or selene; or writing LuaCATS type annotations.
---

# lua-vibe — Lua Best Practices and Ecosystem

## When to Use This Skill

Load this skill whenever the task involves:

- Writing new Lua code or refactoring existing modules.
- Choosing between `local` and a (rarely correct) global, deciding when to use `pcall`, designing a metatable-based "class," or picking between `..` / `string.format` / `table.concat`.
- Resolving `nil`-handling, multiple-return, or truthiness pitfalls.
- Setting up a new project: `rockspec`, `package.path`, directory layout.
- Running tests with `busted` (or compatible runners).
- Configuring `lua-language-server` (`lua_ls`), `stylua`, `luacheck`, or `selene`.
- Adding LuaCATS (`---@`) annotations so editors can type-check call sites.
- Diagnosing performance: hot loops, allocation in tight code, JIT abort patterns, weak tables for caches.
- Reviewing someone's Lua for the standard set of anti-patterns (globals, over-`pcall`, string concatenation in loops, ipairs vs numeric for).

The skill targets **Lua 5.1 / LuaJIT** as the lowest common denominator — what most embedders ship. Differences in 5.2/5.3/5.4 are flagged inline.

## Source Material

- *Programming in Lua* (Roberto Ierusalimschy) — canonical book, multiple editions.
- *Lua 5.1 Reference Manual* — `https://www.lua.org/manual/5.1/`. Authoritative for the language LuaJIT runs.
- *lua-users wiki* — `http://lua-users.org/wiki/` — large body of idiomatic snippets.
- *LuaJIT documentation* — `https://luajit.org/` — JIT semantics, NYI list, performance guide.
- *LuaCATS specification* — `https://luals.github.io/wiki/annotations/` — annotation grammar consumed by `lua_ls`.
- *busted documentation* — `https://lunarmodules.github.io/busted/`.
- *LuaRocks documentation* — `https://github.com/luarocks/luarocks/wiki/`.

## Core Philosophy

These principles are evaluated in order. Each later principle assumes the earlier ones.

### 1. `local` everywhere

Every name that doesn't need to escape its file is `local`. Modules expose their public surface via a single returned table. Globals exist for two reasons only: legacy interop with the embedder, and deliberate convenience symbols (which should be documented and namespaced).

### 2. Tables are the only collection

Lua has one container. Pick a *shape* per variable — array, record, or set — and don't switch shapes mid-pipeline. A function should not return an array sometimes and a record other times.

### 3. Errors are values; `pcall` is for *recoverable* failure

`pcall` is for expected failures (optional dependency, network call, parsing user input). Wrapping every operation in `pcall` produces silent half-failures. Use `assert` for programmer errors and `error(msg, level)` to attribute to the caller.

### 4. Metatables are a tool, not a paradigm

`__index`, `__newindex`, `__call`, and `__tostring` cover 95% of useful metatable work. Inheritance via `__index` is fine; deeper-than-two-level hierarchies are usually wrong. Composition is almost always clearer.

### 5. String building scales with O(n), not O(n²)

`..` is fine for two or three operands. Beyond that, `string.format` for clarity, `table.concat` for loops. Repeated `..` in a loop is O(n²) on the GC.

### 6. Hot paths localize, cold paths read

In a hot inner loop, cache hash lookups (`local fmt = string.format`) and prefer numeric `for i = 1, #t do` over `ipairs`. Outside hot paths, write whichever is clearer. Profile before optimizing — most "slow Lua" is one bad table allocation, not idiomatic style.

### 7. Annotate the public surface, not the private

Add `---@param`, `---@return`, `---@class`, and `---@type` to anything in `M.*`. Internal helpers can stay untyped. Annotations are the contract; types unconsumed by tooling are noise.

### 8. Tooling pays for itself

Run `stylua` (or `lua-format`) on save, `luacheck` or `selene` in CI, `lua-language-server` in your editor. Each catches a different class of bug. The combined runtime cost is sub-second; the bug-prevention rate is high.

### 9. Pin LuaRocks dependencies

A rockspec without a version constraint is a time bomb. Pin to a specific tag or commit; bump deliberately. The same applies to vendored copies in `vendor/` or git submodules.

### 10. Lua 5.1 unless you've checked

Every embedded host has its own Lua version. Default to writing Lua 5.1-compatible code (LuaJIT also runs this) unless you've verified the host supports later. The 5.1 → 5.2/5.3 differences (integer division, bitwise ops, `goto`, `_ENV`) are easy to invoke accidentally.

---

## Language

### Naming

- `snake_case` for variables and functions.
- `PascalCase` for tables intended to be instantiated via metatables (i.e. "classes").
- `SCREAMING_SNAKE_CASE` for module-level constants.
- `_name` underscore prefix for module-private values that are exposed only because Lua has no real privacy.
- `M` (single letter) for the module's returned table at the top of a file. This convention is universal.
- `self` for the implicit first argument of methods declared with `:`.

```lua
local M = {}
local PRIVATE_DEFAULT = 64

local function _internal_helper() end
function M.public_thing() end

return M
```

### Variables and Scope

`local` is mandatory in practice. The omission produces a global, which:

- Costs a hash lookup on every access.
- Pollutes a shared namespace where other code can clobber it.
- Defeats `lua_ls` "undefined global" diagnostics.

```lua
-- Wrong: implicit globals
function helper(x) return x * 2 end       -- creates _G.helper
my_state = {}                              -- creates _G.my_state

-- Right
local function helper(x) return x * 2 end
local my_state = {}
```

In hot paths, also localize stdlib functions:

```lua
local fmt   = string.format
local concat = table.concat
local insert = table.insert
```

The optimization is real (LuaJIT registers vs hash table), but the larger benefit is diagnostic clarity.

### Truthiness

Only `false` and `nil` are falsy. Everything else is truthy, including `0`, `""`, and `{}`.

```lua
if x then ... end           -- x is not nil and not false
if x == nil then ... end    -- explicit nil
if not x then ... end       -- x is nil or false (sometimes ambiguous)
```

When `nil` and `false` mean different things, write the explicit comparison.

### `and` / `or` for Defaults and Ternaries

Lua has no ternary. The idiom is `cond and a or b`, valid as long as `a` is never falsy:

```lua
local label = ok and "yes" or "no"
```

If `a` can legitimately be `false` or `nil`, switch to `if`:

```lua
local val
if ok then val = first_thing else val = fallback end
```

For default arguments:

```lua
function M.greet(name)
  name = name or "world"          -- works as long as name == false isn't valid
  ...
end

function M.toggle(verbose)
  if verbose == nil then verbose = true end   -- distinguishes nil from false
  ...
end
```

### Tables

Lua has one collection. The same table can be:

- An **array** (numeric keys 1..n, no holes): `{1, 2, 3}`. Iterate with `ipairs` or `for i = 1, #t do`.
- A **record** (string keys): `{ name = "ada", year = 1815 }`. Iterate with `pairs`.
- A **set** (keys are members, value is `true`): `{ x = true, y = true }`. Test with `s[k]`.
- A **hybrid**: `{ "first", "second", name = "list" }`. Allowed but read carefully.

Pick a shape per variable. A function that returns an array sometimes and a record other times has one too many responsibilities.

```lua
-- Array
for i, v in ipairs(items) do ... end
for i = 1, #items do local v = items[i]; ... end   -- faster

-- Record
for k, v in pairs(record) do ... end

-- Set
local seen = {}
for _, x in ipairs(items) do
  if not seen[x] then
    seen[x] = true
    process(x)
  end
end
```

#### Length and Holes

`#t` returns *some* boundary in `t`. It is well-defined only for sequences (no `nil` holes). If your array can be sparse, store `n` explicitly:

```lua
local t = { n = 0 }
local function push(v) t.n = t.n + 1; t[t.n] = v end
```

`table.pack(...)` (5.2+, polyfilled in 5.1) and `select("#", ...)` give vararg counts.

#### Iteration Order

`pairs(t)` iteration order is **unspecified** for hash entries. If you need stable output, collect keys into an array and `table.sort` them.

```lua
local keys = {}
for k in pairs(t) do keys[#keys + 1] = k end
table.sort(keys)
for _, k in ipairs(keys) do print(k, t[k]) end
```

### Multiple Return Values

Lua functions return any number of values. Two pitfalls:

- Trailing returns are discarded when the call is not in the last position:
  ```lua
  local a, b = f(), g()      -- only first value of f(); both values of g()
  print(f(), g())            -- only first value of f(); both values of g()
  ```
- Wrapping a call in parentheses truncates to one:
  ```lua
  local a, b = (f())         -- b is always nil
  ```

Use this deliberately when discarding:

```lua
local n = select("#", ...)              -- count varargs
local _, _, third = string.find(...)    -- skip first two captures
```

### Strings

#### Building

`..` allocates and copies both operands. Fine for two or three:

```lua
local greeting = "hello, " .. name .. "!"
```

In loops, use `table.concat`:

```lua
local parts = {}
for i, line in ipairs(lines) do
  parts[i] = line:upper()
end
local joined = table.concat(parts, "\n")
```

For format-style output, use `string.format`:

```lua
local msg = string.format("[%s] %d errors in %s", level, n, file)
```

`%q` quotes a string for round-tripping through `load`/`loadstring`. `%s` calls `tostring` on its argument.

#### Patterns

Lua patterns are *not* regex. They're simpler and faster, with a different syntax. The metacharacters:

```
.   any character
%a  letter           %A  not letter
%d  digit            %D  not digit
%s  whitespace       %S  not whitespace
%w  alphanumeric     %W  not alphanumeric
%p  punctuation      %P  not punctuation
%l  lowercase        %L  not lowercase
%u  uppercase        %U  not uppercase
%c  control          %C  not control
%x  hex              %X  not hex

[]  character class      [^]  negated class
?   0 or 1               *    0 or more (greedy)
+   1 or more (greedy)   -    0 or more (non-greedy)
^   start of subject     $    end of subject
%   escapes magic chars: ( ) . % + - * ? [ ] ^ $
()  capture group
```

```lua
-- Find
local i, j = string.find(s, "%d+")           -- positions of first digit run

-- Match (returns captures or full match)
local year = s:match("(%d%d%d%d)")

-- Iterate matches
for word in s:gmatch("%S+") do print(word) end

-- Replace
local out = s:gsub("%s+", " ")               -- collapse whitespace
```

For real regex, use a library (`lpeg`, `lrexlib`).

#### Common Idioms

```lua
-- Trim
local trimmed = s:match("^%s*(.-)%s*$")

-- Split on a single char
local function split(s, sep)
  local out = {}
  for part in s:gmatch("([^" .. sep .. "]+)") do out[#out + 1] = part end
  return out
end

-- Starts with / ends with
local function starts_with(s, prefix) return s:sub(1, #prefix) == prefix end
local function ends_with(s, suffix)   return suffix == "" or s:sub(-#suffix) == suffix end
```

5.3+ adds `string.pack` / `string.unpack` for binary serialization.

### Control Flow

```lua
if a then ... elseif b then ... else ... end

while cond do ... end
repeat ... until cond                 -- post-test; cond is true to STOP
for i = 1, 10 do ... end
for i = 10, 1, -1 do ... end
for k, v in pairs(t) do ... end

-- 5.2+: break and goto
for i = 1, n do
  if skip(i) then goto continue end
  ...
  ::continue::
end
```

Lua 5.1 has `break` but no `continue`. Use `goto continue` or refactor.

### Functions

Lua functions are first-class values. Common forms:

```lua
local function f(x) return x + 1 end       -- declarative, recommended
local f = function(x) return x + 1 end     -- expression form

-- Method declaration: : injects implicit self
function Animal:speak() print(self.name) end
-- equivalent to:
Animal.speak = function(self) print(self.name) end

-- Method call: : passes receiver as first arg
animal:speak()
-- equivalent to:
animal.speak(animal)
```

`local function` is sugar for `local f; f = function() ... end`. Order matters for self-reference:

```lua
-- Doesn't work: a's body captures b before b exists
local function a() return b() end
local function b() return 1 end

-- Works: declare both, then assign
local a, b
function a() return b() end
function b() return 1 end
```

Varargs are accessed as `...` and counted with `select("#", ...)`:

```lua
local function variadic(...)
  local n = select("#", ...)
  for i = 1, n do
    local arg = select(i, ...)
    print(i, arg)
  end
end
```

### Closures

Inner functions capture outer locals by reference (upvalues). Useful for state hiding:

```lua
local function counter()
  local n = 0
  return function() n = n + 1; return n end
end

local next_id = counter()
print(next_id(), next_id(), next_id())   -- 1, 2, 3
```

Each call to `counter()` produces an independent closure with its own `n`.

---

## Error Handling

### `error` and `assert`

```lua
error("bad input")              -- raises with message; level 1 (this function)
error("bad input", 2)           -- attribute error to caller (preferred for libraries)
error({ code = "EBAD" })        -- non-string errors are allowed

assert(cond, "must be true")    -- if cond is falsy, raises "must be true"
local h = assert(io.open(path)) -- idiom: raise on nil return
```

`error(msg, level)` controls which stack frame the error attributes to. `level = 0` suppresses the position. `level = 2` blames the caller — use it in library code.

`assert(v, msg)` is shorthand for `if not v then error(msg or "assertion failed", 2) end`. Use it for *preconditions* and to unwrap nilable returns.

### `pcall` / `xpcall`

`pcall` runs a function in protected mode. Returns `(true, results...)` on success, `(false, err)` on failure.

```lua
local ok, result = pcall(do_thing, arg)
if not ok then
  -- result is the error message (or value passed to error())
  log_error(result)
  return
end
-- use result
```

`xpcall` is `pcall` plus a handler that runs *inside* the failing frame, so `debug.traceback` produces a useful trace:

```lua
local ok, err = xpcall(do_thing, debug.traceback, arg)
if not ok then print(err) end       -- err is "msg\nstack traceback: ..."
```

### When to `pcall`

Use `pcall` only where:

1. Failure is *expected* (parsing user input, optional dependency, network).
2. You can *recover meaningfully* (fall back to a default, skip a row, retry).

Don't use `pcall` to "be safe." Wrapping every call hides bugs and produces silent half-failures. Prefer letting errors propagate; the embedder usually has a top-level error handler.

```lua
-- Good: optional dependency
local ok, lib = pcall(require, "optional-thing")
if ok then lib.setup() end

-- Bad: shotgun pcall
local ok1, x = pcall(get_x)
if not ok1 then return end
local ok2, y = pcall(get_y)
if not ok2 then return end
local ok3 = pcall(do_thing, x, y)        -- silently fails, no stack trace
```

### Error Objects

`error(value)` accepts any value, not just strings. Returning a structured error from a library is common:

```lua
local function load_config(path)
  local f, err = io.open(path)
  if not f then
    error({ code = "EOPEN", path = path, cause = err }, 2)
  end
  ...
end

local ok, err = pcall(load_config, "/missing")
if not ok and type(err) == "table" and err.code == "EOPEN" then
  -- handle structured
end
```

For interop, also stringify on the way out so `tostring(err)` is human-readable:

```lua
setmetatable(err, { __tostring = function(self) return self.code .. ": " .. self.path end })
```

### `pcall` and `xpcall` Differences

| Function | Handler runs in failing frame? | Use when |
|---|---|---|
| `pcall(fn, ...)` | No | You need only the message |
| `xpcall(fn, handler, ...)` | Yes | You want a stack trace; you want a custom transformation of the error |

In Lua 5.1, `xpcall` doesn't accept arguments after the handler:

```lua
-- 5.1: pass via closure
xpcall(function() return do_thing(arg) end, debug.traceback)

-- 5.2+
xpcall(do_thing, debug.traceback, arg)
```

---

## Metatables and OOP

A metatable hooks operations on a table. The metamethods to know:

| Metamethod | Triggers |
|---|---|
| `__index` | `t[k]` when `k` is missing; lookup fallback |
| `__newindex` | `t[k] = v` when `k` is missing; write hook |
| `__call` | `t(...)` ; makes the table callable |
| `__tostring` | `tostring(t)` |
| `__eq`, `__lt`, `__le` | Comparison operators (operands must share metatable for `__eq` in 5.1) |
| `__add`, `__sub`, `__mul`, `__div`, `__mod`, `__pow`, `__unm`, `__concat`, `__len` | Arithmetic, concat, length |
| `__metatable` | Hides the metatable from `getmetatable` |
| `__gc` (5.2+) | Run when table is garbage-collected |
| `__pairs`, `__ipairs` (5.2 only) | Custom iteration |

### `__index` for Lookup Fallback

```lua
local defaults = { color = "blue", size = 10 }
local instance = setmetatable({ size = 20 }, { __index = defaults })

print(instance.size)   -- 20 (own field)
print(instance.color)  -- "blue" (from defaults)
```

`__index` can be a table (looked up) or a function (called with `(t, k)`).

### Class Pattern

```lua
local Animal = {}
Animal.__index = Animal               -- the class is its own __index

function Animal.new(name)
  return setmetatable({ name = name }, Animal)
end

function Animal:speak()
  print(self.name .. " makes a sound")
end

local a = Animal.new("Felis")
a:speak()                             -- "Felis makes a sound"
```

The two conventions:

1. `Animal.new(...)` — a constructor function on the class table. Some style guides prefer `Animal()` via `__call`.
2. Methods declared with `:` (implicit `self`).

### Inheritance

Single inheritance is `__index` chained to a parent:

```lua
local Cat = setmetatable({}, { __index = Animal })
Cat.__index = Cat

function Cat.new(name)
  local self = Animal.new(name)
  return setmetatable(self, Cat)
end

function Cat:purr() print(self.name .. " purrs") end

local k = Cat.new("Mochi")
k:speak()    -- inherited
k:purr()     -- own
```

Avoid hierarchies deeper than two levels. A class hierarchy in Lua is almost always a refactoring opportunity for composition.

### Composition Over Inheritance

```lua
local function make_animal(name)
  return {
    name = name,
    speak = function(self) print(self.name .. " makes a sound") end,
  }
end

local function make_cat(name)
  local self = make_animal(name)
  self.purr = function(s) print(s.name .. " purrs") end
  return self
end
```

This is less efficient (each instance has its own method copies) but trivial to understand. Use it when the type hierarchy is small.

### Read-Only Tables

```lua
local function readonly(t)
  return setmetatable({}, {
    __index = t,
    __newindex = function() error("read-only", 2) end,
    __metatable = "locked",
  })
end

local config = readonly({ host = "localhost", port = 5432 })
config.host = "x"   -- error: read-only
```

### Callable Tables

```lua
local counter = setmetatable({ n = 0 }, {
  __call = function(self, step)
    self.n = self.n + (step or 1)
    return self.n
  end,
})

counter()        -- 1
counter(5)       -- 6
counter.n        -- 6
```

### Metatable Pitfalls

- `getmetatable(t)` returns the metatable. To hide it, set `__metatable` to any value; subsequent `getmetatable` calls return that value and `setmetatable` errors.
- In Lua 5.1, `__eq` requires both operands to share the *same* metatable, not just compatible ones. 5.2+ relaxed this.
- Metamethods are *not* inherited via `__index`. `setmetatable(b, { __index = a })` does not make `b`'s `__index` chain pick up `a`'s `__add`.

---

## Modules and `require`

A Lua module is a file that returns a value (almost always a table):

```lua
-- mymod.lua
local M = {}

local function private_helper(x) return x * 2 end

function M.upper(s) return s:upper() end
function M.double(x) return private_helper(x) end

return M
```

```lua
-- consumer
local mymod = require("mymod")
print(mymod.upper("hi"))
print(mymod.double(21))
```

### How `require` Resolves

`require("foo.bar")` searches `package.path` for `foo/bar.lua` (then `foo/bar/init.lua`), then `package.cpath` for compiled C modules. The first match wins.

`package.path` is a `;`-separated list of templates, where `?` is replaced with the dotted name (with `.` → `/`):

```lua
print(package.path)
-- /usr/share/lua/5.1/?.lua;/usr/share/lua/5.1/?/init.lua;./?.lua
```

Customize early in your program:

```lua
package.path = "./src/?.lua;./src/?/init.lua;" .. package.path
```

### `package.loaded` and Caching

`require` caches results in `package.loaded[name]`. Subsequent `require` of the same name returns the cached value without re-executing:

```lua
local a = require("mymod")
local b = require("mymod")
print(a == b)            -- true
```

To force a reload (typically during development):

```lua
package.loaded.mymod = nil
local fresh = require("mymod")
```

### Side-Effect Modules

A module file can run code with no return value. Consumers `require()` it for the side effect:

```lua
-- side_effect.lua
print("loaded once")
_G.SOMETHING = true        -- (only if you really mean to set a global)

-- consumer
require("side_effect")
```

This is fine but uncommon. Most modules return a table.

### Avoiding `module()`

Older Lua (≤5.1) had a `module(name)` function that registered the file as a module and changed `_ENV`. It's deprecated and removed in 5.2+. Always use the `local M = {}; ... ; return M` pattern.

### Project Layout

A medium Lua project:

```
myproject/
├── myproject-1.0-1.rockspec
├── src/
│   └── myproject/
│       ├── init.lua             -- require("myproject") loads this
│       ├── parser.lua           -- require("myproject.parser")
│       └── util/
│           ├── init.lua         -- require("myproject.util")
│           └── strings.lua      -- require("myproject.util.strings")
├── spec/                        -- busted tests
│   ├── parser_spec.lua
│   └── util/strings_spec.lua
├── bin/
│   └── myproject                -- launcher script
└── README.md
```

Conventions:

- `src/<name>/init.lua` is the public API root.
- One concern per file. A 500-line module is a refactor candidate.
- Submodules nest via dotted require: `require("myproject.util.strings")`.
- Tests live under `spec/` (busted convention) or `tests/`.

### Avoiding Circular Imports

If `a.lua` requires `b.lua` and `b.lua` requires `a.lua`, the second `require` returns a partially-built table. Bugs follow.

Resolutions:

1. Extract the shared piece into a third module both depend on.
2. Lazy-`require` inside a function body:
   ```lua
   function M.do_thing() return require("b").other() end
   ```
3. Refactor so dependency goes one way.

The lazy-require pattern is also a small optimization: the import only resolves on first call.

---

## Performance

Lua-level optimizations matter only in real hot paths. Profile first; never pre-optimize startup code.

### Locals Are Cheap, Globals Are Not

`local x` lives in a register (or upvalue). `_G.x` is a hash lookup. Cache library functions in hot paths:

```lua
local fmt    = string.format
local floor  = math.floor
local insert = table.insert

for i = 1, n do
  insert(out, fmt("%d", floor(values[i])))
end
```

### Numeric `for` Beats `ipairs`

`ipairs` calls a function each iteration. `for i = 1, #t do` is a register increment.

```lua
-- Slower
for i, v in ipairs(t) do work(v) end

-- Faster
for i = 1, #t do work(t[i]) end
```

The difference is small for short loops, large for inner loops over millions of items.

### Avoid Allocation in Hot Loops

Each new table or string on the inside of a loop is GC pressure. Move them out:

```lua
-- Allocates a new table per iteration
for i = 1, n do
  process({ key = "x", value = items[i] })
end

-- Reuses one
local arg = { key = "x" }
for i = 1, n do
  arg.value = items[i]
  process(arg)
end
```

Same for strings: `string.format` allocates; cache or use `table.concat` for many fragments.

### Pre-Allocate Tables

If you know the size, set `t[n]` first to extend the array part:

```lua
local t = {}
for i = 1, n do t[i] = compute(i) end
```

LuaJIT's `table.new(narray, nhash)` (from `require("table.new")`) lets you pre-size both parts:

```lua
local table_new = require("table.new")
local t = table_new(1024, 0)
```

### `table.concat` Beats `..` in Loops

`..` is O(n) per concatenation, O(n²) over a loop:

```lua
-- O(n²)
local s = ""
for _, line in ipairs(lines) do s = s .. line .. "\n" end

-- O(n)
local s = table.concat(lines, "\n")
```

For mixed content, push fragments and concat at the end:

```lua
local parts = {}
for _, item in ipairs(items) do
  parts[#parts + 1] = item.name
  parts[#parts + 1] = "="
  parts[#parts + 1] = tostring(item.value)
  parts[#parts + 1] = "; "
end
local out = table.concat(parts)
```

### Weak Tables for Caches

`__mode = "k"`, `"v"`, or `"kv"` makes keys, values, or both weak — eligible for GC even while in the table.

```lua
local cache = setmetatable({}, { __mode = "v" })

function get(k)
  local v = cache[k]
  if v == nil then v = compute(k); cache[k] = v end
  return v
end
```

Useful when the cache should not prevent collection of large referenced values.

### LuaJIT Notes

LuaJIT compiles hot loops to native code. A few practices keep the JIT happy:

- Avoid functions on the **NYI** (Not-Yet-Implemented) list inside hot loops: `pairs` is fine, `next` is fine, but `string.gmatch` triggers a trace abort. The full list: `https://wiki.luajit.org/NYI`.
- Avoid `pcall` inside hot loops; the protected frame breaks traces.
- Avoid creating closures inside hot loops; closure allocation is not JIT-friendly.
- Use the FFI (`require("ffi")`) for performance-critical numerical work; it's faster than calling C through the Lua API.

For pure Lua 5.1/5.4 (no JIT), these don't apply — the interpreter has a flatter performance profile.

### When *Not* to Optimize

Config files, startup code, one-shot scripts: write them clearly. The time spent reading the code outweighs any nanosecond gains.

---

## Coroutines

Lua coroutines are first-class non-preemptive threads. They yield control via `coroutine.yield` and resume via `coroutine.resume`. The model:

```lua
local co = coroutine.create(function(initial)
  print("started with", initial)
  local x = coroutine.yield("first yield")
  print("resumed with", x)
  return "done"
end)

print(coroutine.resume(co, 10))   -- true, "first yield"  (after print "started with 10")
print(coroutine.resume(co, 20))   -- true, "done"          (after print "resumed with 20")
print(coroutine.resume(co))        -- false, "cannot resume dead coroutine"
```

`coroutine.status(co)` returns `"suspended"`, `"running"`, `"normal"`, or `"dead"`.

### When to Use

- **Generators** — produce a sequence lazily:
  ```lua
  local function range(n)
    return coroutine.wrap(function()
      for i = 1, n do coroutine.yield(i) end
    end)
  end

  for v in range(5) do print(v) end
  ```
- **Async flow control** — drive callback-based APIs in a synchronous-looking style. Many Lua async libraries (`copas`, `cqueues`, `lua-resty-*`) build on coroutines.
- **State machines** — when a chunk of code has phases that interleave with external events.

### `coroutine.wrap`

`coroutine.wrap(fn)` returns a function that resumes the coroutine. Unlike `resume`, it propagates errors instead of returning `(false, err)`. Convenient for generators; risky if you need to handle errors at the resume point.

### When *Not* to Use

For one-shot async, a callback is simpler. Coroutines shine when you need to suspend mid-function for cleanliness — generators, structured async, cooperative scheduling.

---

## Standard Library Cheat Sheet

| Need | Function |
|---|---|
| **String** |  |
| Format string | `string.format(fmt, ...)` |
| Find | `string.find(s, pat[, init[, plain]])` |
| Match (returns captures) | `string.match(s, pat[, init])` |
| Gmatch (iterator) | `string.gmatch(s, pat)` |
| Substitute | `string.gsub(s, pat, repl[, n])` |
| Lower/upper | `s:lower()` / `s:upper()` |
| Sub | `s:sub(i[, j])` |
| Length | `#s` (bytes, not code points) |
| Repeat | `string.rep(s, n[, sep])` |
| Reverse | `string.reverse(s)` |
| Byte/char | `string.byte(s[, i[, j]])` / `string.char(...)` |
| Trim (idiom) | `s:match("^%s*(.-)%s*$")` |
| **Table** |  |
| Insert/remove | `table.insert(t, [pos,] v)` / `table.remove(t[, pos])` |
| Sort | `table.sort(t[, cmp])` |
| Concat | `table.concat(t[, sep[, i[, j]]])` |
| Pack/unpack (5.2+) | `table.pack(...)` / `table.unpack(t)` (5.1: `unpack(t)`) |
| **Math** |  |
| Floor/ceil | `math.floor(x)` / `math.ceil(x)` |
| Abs/sign | `math.abs(x)` / `math.sign` not built-in |
| Min/max | `math.min(...)` / `math.max(...)` |
| Random | `math.random([m[, n]])` ; seed with `math.randomseed(s)` |
| Modf | `math.modf(x)` returns int and frac parts |
| Trig | `math.sin/cos/tan/asin/acos/atan(y[, x])` |
| Power/sqrt | `x ^ n` / `math.sqrt(x)` (5.1: `math.pow(x,n)` also exists) |
| Pi/huge | `math.pi` / `math.huge` |
| **OS** |  |
| Time | `os.time()` ; `os.date(fmt[, t])` |
| Clock | `os.clock()` (CPU time) |
| Diff | `os.difftime(t2, t1)` |
| Env | `os.getenv("HOME")` |
| Execute | `os.execute(cmd)` (returns success in 5.2+) |
| Exit | `os.exit([code[, close]])` |
| Tmp | `os.tmpname()` ; `os.remove(path)` ; `os.rename(old, new)` |
| **IO** |  |
| Open | `io.open(path, mode)` returns file or `nil, err` |
| Lines | `io.lines(path)` ; `f:lines()` |
| Read | `f:read(fmt)` (`"*a"`, `"*l"`, `"*n"`, n-bytes) |
| Write | `f:write(...)` |
| Close | `f:close()` |
| Stdout/stderr | `io.stdout`, `io.stderr`, `io.stdin` |
| **Type Probes** |  |
| `type(v)` | `"nil"`, `"boolean"`, `"number"`, `"string"`, `"table"`, `"function"`, `"thread"`, `"userdata"` |
| `tostring(v)` / `tonumber(v[, base])` |  |
| `select(n, ...)` / `select("#", ...)` |  |
| `pairs(t)` / `ipairs(t)` / `next(t[, k])` |  |
| `getmetatable(t)` / `setmetatable(t, mt)` |  |
| `rawget(t, k)` / `rawset(t, k, v)` / `rawequal(a, b)` / `rawlen(t)` (5.2+) |  |

---

## Tooling and Ecosystem

### `lua-language-server` (lua_ls)

The reference LSP server for Lua, also the reference LuaCATS implementation. Install via OS package manager, LuaRocks, or the upstream releases.

Project config lives in `.luarc.json` (or `.luarc.jsonc`):

```json
{
  "runtime": { "version": "Lua 5.1" },
  "diagnostics": {
    "globals": ["describe", "it", "before_each", "after_each", "setup", "teardown"]
  },
  "workspace": {
    "checkThirdParty": false,
    "library": ["${3rd}/luv/library", "${3rd}/busted/library"]
  },
  "completion": { "callSnippet": "Replace" },
  "format": { "enable": false }
}
```

`globals` silences "undefined global" diagnostics for symbols injected by the embedder or test runner. `library` adds prebuilt definitions for common dependencies.

`runtime.version` accepts `"Lua 5.1"`, `"Lua 5.2"`, `"Lua 5.3"`, `"Lua 5.4"`, `"LuaJIT"`. Set it explicitly; the default is 5.4 and may flag valid 5.1 code.

### LuaCATS Annotations

LuaCATS (Lua Comment And Type System) is the de facto annotation grammar. The minimum useful set:

```lua
---@class MyConfig
---@field timeout number
---@field servers string[]
---@field on_ready? fun(): nil

---@param opts MyConfig
---@return string
function M.format(opts)
  ...
end

---@type table<string, integer>
local counters = {}

---@alias Direction "north" | "south" | "east" | "west"

---@enum LogLevel
local LogLevel = { ERROR = 1, WARN = 2, INFO = 3, DEBUG = 4 }

---@generic T
---@param list T[]
---@param pred fun(item: T): boolean
---@return T[]
function M.filter(list, pred) ... end
```

Common tags:

| Tag | Purpose |
|---|---|
| `---@class Name : Parent` | Define a class type |
| `---@field name type` | Class field |
| `---@param name type` | Function parameter |
| `---@return type [name]` | Function return |
| `---@type type` | Type of a variable |
| `---@alias Name type` | Type alias |
| `---@enum Name` | Enum (table of constants) |
| `---@generic T` | Type parameter |
| `---@vararg type` (5.1) / `---@param ... type` | Vararg type |
| `---@nodiscard` | Warn if return value is ignored |
| `---@deprecated` | Mark as deprecated |
| `---@diagnostic disable-next-line: undefined-global` | Suppress one diagnostic |

Annotate exported functions; skip internal helpers unless they're tricky.

### `stylua` — Formatter

The standard Lua formatter. Configuration via `stylua.toml`:

```toml
column_width = 100
line_endings = "Unix"
indent_type = "Spaces"
indent_width = 2
quote_style = "AutoPreferDouble"
call_parentheses = "Always"
collapse_simple_statement = "Never"
```

Run on save (editor integration) and in CI:

```bash
stylua --check .            # CI: exit non-zero on diff
stylua .                    # apply formatting
```

Alternative: `lua-format` (older, less widely adopted). Prefer `stylua` for new projects.

### `luacheck` — Static Linter

Detects unused locals, unreachable code, accidental globals, shadowed variables, and a long list of style issues. Configuration via `.luacheckrc`:

```lua
-- .luacheckrc
std = "lua51"                                  -- or "luajit", "max", "+busted"

globals = {
  "describe", "it", "before_each", "after_each",
}

ignore = {
  "212/_.*",                                   -- unused argument starting with _
  "631",                                       -- line too long (let stylua handle width)
}

files["spec/"] = { std = "+busted" }
```

```bash
luacheck .
luacheck src/                                  # only check src
luacheck --formatter plain --ranges .         # CI-friendly output
```

### `selene` — Modern Linter

A faster, Rust-built alternative to luacheck with similar coverage. Configuration via `selene.toml`:

```toml
std = "lua51+busted"

[config]
unused_variable = { allow_unused_self = true, ignore_pattern = "^_" }
empty_if = "deny"
```

`selene` and `luacheck` overlap heavily; pick one. `selene` is faster and the rules are clearer; `luacheck` has wider community config.

### `busted` — Test Runner

The standard Lua testing framework. RSpec-style.

```lua
-- spec/parser_spec.lua
describe("parser", function()
  local parser

  before_each(function()
    parser = require("myproject.parser").new()
  end)

  it("parses an empty string", function()
    assert.are.equal({}, parser:parse(""))
  end)

  it("rejects malformed input", function()
    assert.has_error(function() parser:parse("{{{") end)
  end)

  describe("with options", function()
    it("respects strict mode", function()
      local p = parser:with({ strict = true })
      assert.is_true(p.strict)
    end)
  end)
end)
```

Run:

```bash
busted                              # auto-discovers spec/
busted spec/parser_spec.lua         # one file
busted -o utfTerminal               # pretty terminal output
busted --coverage                   # with luacov coverage
```

`assert` library extensions:
- `assert.are.equal(expected, actual)` — value equality
- `assert.are.same(expected, actual)` — deep table equality
- `assert.is_true(v)`, `assert.is_false(v)`, `assert.is_nil(v)`, `assert.is_not_nil(v)`
- `assert.has_error(fn[, msg])` — fn raises (optionally with a specific message)
- `assert.has_no.errors(fn)`
- Negation via `assert.is_not.equal(...)` etc.

### LuaRocks — Package Manager

LuaRocks installs Lua modules into a tree (system or per-user). A package is described by a *rockspec* file.

#### Minimal `rockspec`

```lua
-- myproject-1.0-1.rockspec
package = "myproject"
version = "1.0-1"
source = {
  url = "git+https://github.com/me/myproject.git",
  tag = "v1.0",
}
description = {
  summary = "A short summary",
  detailed = [[
    A longer description.
  ]],
  homepage = "https://github.com/me/myproject",
  license = "MIT",
}
dependencies = {
  "lua >= 5.1, < 5.5",
  "lpeg ~> 1.0",
  "luafilesystem ~> 1.8",
}
build = {
  type = "builtin",
  modules = {
    ["myproject"]         = "src/myproject/init.lua",
    ["myproject.parser"]  = "src/myproject/parser.lua",
    ["myproject.util.strings"] = "src/myproject/util/strings.lua",
  },
  install = {
    bin = { "bin/myproject" },
  },
}
```

#### Common Commands

```bash
luarocks init                                  # scaffold a project
luarocks install <package> [<version>]
luarocks install --local <package>             # ~/.luarocks instead of system
luarocks make                                  # install current rockspec
luarocks remove <package>
luarocks list                                  # installed
luarocks search <name>
luarocks lint <rockspec>
luarocks doc <package>
luarocks path                                  # exports for shell setup
luarocks upload <rockspec>                     # publish
```

#### Per-Project Tree

Use `luarocks` with a project-local tree to keep dependencies pinned:

```bash
eval "$(luarocks --tree=lua_modules path)"
luarocks --tree=lua_modules install ...
```

Combined with a `.busted` and a `Makefile`, this gives reproducible builds.

#### Version Constraints

| Spec | Meaning |
|---|---|
| `"lpeg"` | Any version |
| `"lpeg >= 1.0"` | At least 1.0 |
| `"lpeg ~> 1.0"` | 1.x, ≥ 1.0 |
| `"lpeg == 1.0.2"` | Exactly 1.0.2 |

Always pin in production. `~>` is the usual default — allows patch updates, blocks majors.

### Common Project Boilerplate

```
myproject/
├── .editorconfig
├── .gitignore
├── .luacheckrc                       (or selene.toml)
├── .luarc.json
├── .stylua.toml
├── README.md
├── LICENSE
├── myproject-1.0-1.rockspec
├── Makefile                          (or justfile)
├── src/
│   └── myproject/
│       ├── init.lua
│       └── ...
├── spec/
│   └── ...
└── bin/
    └── myproject
```

A typical `Makefile`:

```make
.PHONY: install test lint format check

install:
	luarocks --tree=lua_modules make

test:
	busted

lint:
	luacheck src spec

format:
	stylua src spec

check: lint test
	stylua --check src spec
```

---

## Templates

### Minimal Module

```lua
local M = {}

---@param s string
---@return string
function M.upper(s)
  return s:upper()
end

return M
```

### Module with Internal State

```lua
local M = {}

local cache = {}                       -- file-local, not exported

---@param key string
---@return any
function M.get(key)
  if cache[key] == nil then
    cache[key] = compute(key)
  end
  return cache[key]
end

function M.clear()
  cache = {}
end

return M
```

### Class via Metatable

```lua
---@class Animal
---@field name string
local Animal = {}
Animal.__index = Animal

---@param name string
---@return Animal
function Animal.new(name)
  return setmetatable({ name = name }, Animal)
end

function Animal:speak()
  print(self.name .. " makes a sound")
end

return Animal
```

### Inherited Class

```lua
local Animal = require("myproject.animal")

---@class Cat : Animal
local Cat = setmetatable({}, { __index = Animal })
Cat.__index = Cat

---@param name string
---@return Cat
function Cat.new(name)
  local self = Animal.new(name)
  return setmetatable(self, Cat)
end

function Cat:purr()
  print(self.name .. " purrs")
end

return Cat
```

### Error-Returning Function (Go-Style)

Avoid raising; return `value, err` so callers decide:

```lua
---@param path string
---@return string? content, string? err
function M.read_file(path)
  local f, open_err = io.open(path, "r")
  if not f then return nil, open_err end
  local content = f:read("*a")
  f:close()
  return content
end

local content, err = M.read_file("/missing")
if not content then
  print("failed: " .. err)
  return
end
```

### Iterator (Generator)

```lua
---@param n integer
---@return fun(): integer?
function M.range(n)
  return coroutine.wrap(function()
    for i = 1, n do coroutine.yield(i) end
  end)
end

for v in M.range(5) do print(v) end
```

### Stateful Iterator (Idiom Without Coroutine)

```lua
function M.range(n)
  local i = 0
  return function()
    i = i + 1
    if i <= n then return i end
  end
end
```

Faster and JIT-friendly. Prefer this over coroutine-based generators in hot code.

### Common Helpers

```lua
local M = {}

---@generic K, V
---@param t table<K, V>
---@return table<K, V>
function M.copy(t)
  local out = {}
  for k, v in pairs(t) do out[k] = v end
  return out
end

---@generic K, V
---@param a table<K, V>
---@param b table<K, V>
---@return table<K, V>
function M.merge(a, b)
  for k, v in pairs(b) do a[k] = v end
  return a
end

---@generic T
---@param list T[]
---@param pred fun(item: T): boolean
---@return T[]
function M.filter(list, pred)
  local out = {}
  for _, v in ipairs(list) do
    if pred(v) then out[#out + 1] = v end
  end
  return out
end

---@generic T, U
---@param list T[]
---@param fn fun(item: T): U
---@return U[]
function M.map(list, fn)
  local out = {}
  for i, v in ipairs(list) do out[i] = fn(v) end
  return out
end

---@param s string
---@param sep string  one character
---@return string[]
function M.split(s, sep)
  local out = {}
  for part in s:gmatch("([^" .. sep .. "]+)") do out[#out + 1] = part end
  return out
end

---@param s string
---@return string
function M.trim(s)
  return (s:match("^%s*(.-)%s*$"))
end

return M
```

### `busted` Spec

```lua
describe("util.strings", function()
  local strings

  before_each(function() strings = require("myproject.util.strings") end)

  describe("split", function()
    it("splits on a single separator", function()
      assert.are.same({ "a", "b", "c" }, strings.split("a,b,c", ","))
    end)

    it("returns an empty table for an empty string", function()
      assert.are.same({}, strings.split("", ","))
    end)

    it("ignores trailing separators", function()
      assert.are.same({ "a", "b" }, strings.split("a,b,,", ","))
    end)
  end)

  describe("trim", function()
    it("removes leading and trailing whitespace", function()
      assert.are.equal("hi", strings.trim("   hi   "))
    end)
  end)
end)
```

---

## Anti-Patterns

### Language

1. **Implicit globals.** `function helper(x) ... end` at module scope creates `_G.helper`. Always `local`.
2. **`pcall(require, "...")` for required modules.** Hides installation failures. Reserve `pcall` for genuinely optional dependencies.
3. **Wrapping every operation in `pcall`.** Silent half-failures, no stack traces. `pcall` only at the boundary where you can recover.
4. **String concatenation in a loop.** O(n²). Use `table.concat`.
5. **`ipairs` in a hot loop.** Use `for i = 1, #t do` for measurable speedup.
6. **Local function self-reference broken by ordering.** `local function a() return b() end` where `b` is declared later. Forward-declare.
7. **Returning multiple values when a table would be clearer.** Caller must remember positional order; adding a fourth value silently changes the API. Return a record table.
8. **Comparing tables with `==`.** Identity comparison unless `__eq` is set on both operands. Use a deep-equal helper if you mean structural equality.
9. **Modifying a table while iterating.** `for k, v in pairs(t) do t[k] = nil end` is undefined. Collect keys first, then mutate.
10. **`#t` on a table with holes.** Result is implementation-defined. Maintain `t.n` or use a non-sparse representation.

### Style

11. **Multiline `loadstring`/`load` blobs that build code as strings.** Prefer real Lua structure; reserve dynamic `load` for genuine sandboxing or DSL needs.
12. **`camelCase` field names** in a Lua project. Convention is `snake_case`.
13. **No `desc`/comment on public functions.** Future-you and code reviewers suffer.
14. **Polluting `_G` with helpers** instead of returning a module table.
15. **Using `module(name)`.** Deprecated. Use `local M = {}; ...; return M`.

### Errors

16. **Catching with `pcall` and discarding `err`.** At minimum log it. Better: only `pcall` where you have a recovery path.
17. **`assert(io.open(path))` without a message.** `io.open` returns `(nil, err)` on failure; assert raises with the err — fine. `assert(condition)` without a message raises a generic "assertion failed" — add a message.
18. **`error("msg")` from a library function.** Pass `level = 2` so the error blames the caller, not the library function: `error("bad arg", 2)`.

### Performance

19. **Allocating a closure per loop iteration.** Hoist or use a stateful iterator.
20. **Calling NYI functions inside JIT'd hot paths** (LuaJIT only). Check the NYI list.
21. **Running `pcall` inside a hot inner loop** under LuaJIT — breaks traces. Move the protected boundary outside.
22. **Unnecessary deep copies.** Copy only at trust boundaries.

### Tooling

23. **Skipping `.luarc.json` runtime version.** Defaults to 5.4; flags valid 5.1 code.
24. **Floating LuaRocks dependencies (no version constraint).** Pin with `~>` or `==`.
25. **No CI step for lint + test + format-check.** All three are sub-second; the bug-prevention rate is high.

---

## Verification Commands

Run after Lua changes:

```bash
# Format
stylua --check src spec
stylua src spec                            # apply

# Lint
luacheck src spec
selene src spec                            # alternative

# Type-check (offline)
lua-language-server --check .              # full project check

# Test
busted                                     # auto-discovers spec/
busted --coverage                          # with luacov

# Sanity load (Lua 5.1 / LuaJIT)
lua -e "require('myproject')"
luajit -e "require('myproject')"

# Inspect a value
lua -e "print(require('inspect')(require('myproject').compute()))"

# REPL
lua
luajit
```

---

## Communication Style

When applying this skill:

- State the Lua version targeted (`5.1`, `5.2`, `5.3`, `5.4`, `LuaJIT`). Default to 5.1/LuaJIT-compatible unless told otherwise.
- Quote section/function from the *Lua Reference Manual* when making non-obvious claims.
- Distinguish *language* concerns (syntax, semantics) from *idiom* concerns (style, naming).
- Recommend the smallest change. Don't propose a metatable when a function will do.
- Push back on `pcall`-everywhere, manual loops where a stdlib call exists, or premature OOP.
- Mention LuaJIT-specific notes only when the user has confirmed LuaJIT (or the embedder is LuaJIT-only).
- Run `stylua --check`, `luacheck`/`selene`, and `busted` after non-trivial edits and report results.

## Hard Rules

1. **Always `local`.** Globals exist only for deliberate, namespaced exports.
2. **Never wrap a required `require()` in `pcall`.** Reserve `pcall` for actually-optional code.
3. **Always return a table from a module file.** Never use `module(name)`.
4. **Never modify a table while iterating it with `pairs`.** Collect-then-mutate.
5. **Pin LuaRocks dependencies in production rockspecs.** Floating constraints are time bombs.
