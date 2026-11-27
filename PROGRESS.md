# CMD Simulator — Progress

Web-based Windows Command Prompt simulator with an in-memory virtual file system.
Three files, no build, no server: open `index.html` in a browser.

| File | What is in it |
|---|---|
| `index.html` | Page structure: title bar, terminal, cheat sheet, settings panel |
| `style.css` | All styling (layout, terminal, cursor shapes, sidebar, settings) |
| `script.js` | All logic: `VFS`, `CommandParser`, `COMMANDS` table, `Shell`, `Terminal` |
| `test.js` | Self-check, run with `node test.js` |

Marks: `[x]` done and exercised · `[~]` in progress · `[ ]` not started · `[!]` blocked

## 🆕 What changed in this update

**2026-11-25 — split into 3 files, code rewritten simpler, more customization.**

- **Split:** the single `index.html` is now `index.html` + `style.css` + `script.js`. This replaces the spec's "single file" constraint, on Seif's request.
- **Simpler code:** `script.js` rewritten for readability — one statement per line, plain names, a comment on every function, commands receive `(sh, cmd)` explicitly, file-system nodes are plain objects with a `parent` link.
- **More customization:**
  - New **Settings** panel (title-bar button): theme presets (7), background colour, text colour, font, font size, cursor shape (underscore / block / bar), cursor blinking, reset. Saved in the browser (`localStorage`) so it survives a refresh.
  - New **`prompt`** command with the real CMD codes (`$P $G $D $T $N $L $S $_ $$`).
  - `color` and the Settings panel stay in step with each other.
- **Removed to keep the code simple** (none of it was in the spec — see the table at the bottom): `rmdir /s` confirmation question, `findstr` patterns, smart `fc` diff, `where` searching `%PATH%`, aliases, a few extra switches.
- Both checks re-run after the rewrite and passing: `node test.js`, and the real page in headless Chrome.

## 1. Terminal UI & customization

- [x] CMD look: monospace font, black window, title bar, `C:\Users\Student>` prompt that follows `cd`
- [x] Cursor that sits under the caret (Left/Right/Home/End, mid-line insert), blinking
- [x] Command history with Up/Down (stops at oldest/newest); Esc clears the line
- [x] Blank line after each command, none after `cls` or an empty Enter — as in real CMD
- [x] `cls`
- [x] `title <text>` — changes header bar and browser tab
- [x] `color <hex>` — `0A`, `1F`, one digit, no args resets; same-digit/invalid shows help
- [x] `prompt <text>` — `$P $G $D $T $N $L $S $_ $$`, variables allowed, no args resets
- [x] Settings panel
  - [x] Theme presets: Classic CMD, Matrix green, Blue, PowerShell, Amber retro, Ubuntu, Light
  - [x] Background and text colour pickers (theme list goes blank for a custom pair)
  - [x] Font: Consolas, Cascadia Mono, Lucida Console, Courier New
  - [x] Font size 10–28px
  - [x] Cursor shape: underscore, block, bar
  - [x] Cursor blinking on/off
  - [x] Reset to defaults
  - [x] Saved between visits; survives reload
- [x] Click anywhere in the terminal to type; selecting output to copy still works
- [x] Small screens: sidebar starts collapsed and overlays, default font 13px, no horizontal overflow at 390px

## 2. Virtual file system & directory commands

- [x] Seeded tree: `C:\`, `C:\Program Files`, `C:\Users\Public`, `C:\Users\Student` (+ `Desktop`, `Documents`, `Downloads`, hidden `AppData`), `C:\Windows\System32`
- [x] Sample files: `welcome.txt`, `Documents\{notes,todo,fruits,report_v1,report_v2}.txt`, `C:\Windows\{win.ini,setuplog.txt}`, hidden `ntuser.ini`
- [x] Case-insensitive names, stored spelling shown; `.`/`..`; absolute and relative paths; `/` accepted as separator
- [x] `cd` · `cd ..` · `cd..` · `cd \` · `cd <path>` · quoted and unquoted names with spaces · `cd /d` · alone prints path
- [x] `mkdir a b c` · nested `mkdir Parent\Child` · "already exists" · invalid-name error
- [x] `rmdir` (empty only) · `rmdir /s` · `rmdir /s /q` · refuses the current folder
- [x] `dir` with timestamps, sizes, totals, `.` and `..` · `dir /w` · `dir /a` · `dir *.txt` · `dir <path>` · "File Not Found"
- [x] `tree` · `tree /f` · `tree /a` · `tree /f /a > filename.txt` · `tree <path>`

## 3. File & text-processing commands

- [x] `echo <text>` · `> file` · `>> file` · `echo. > file` · `echo` alone
- [x] Redirection `>` / `>>` on **every** command (quoted targets, `>` inside quotes is text)
- [x] `type <file>`
- [x] `copy <src> <dst>` — rename, into a folder, wildcard `copy *.txt <dest>`
- [x] `del <file>` · `del *.txt` · several names
- [x] `attrib <file>` · `attrib` (lists folder) · `+r`/`-r` blocks `del`, `>`, `>>`, `copy` onto it · `+h`/`-h` hides from `dir`
- [x] `find "string" <file>` · `/i` · `/c` · unquoted string rejected like the real one
- [x] `findstr "word1 word2"` (any word) · `/i` · `/n` · `/c:"exact phrase"`
- [x] `sort <file>` · `/r` · `<file> /o <outfile>`
- [x] `fc <f1> <f2>` · `/c`
- [x] `where <file>` (current folder, wildcards) · `where /R <dir> <pattern>`

## 4. System & environment

- [x] `set` · `set PREFIX` · `set NAME=value` · `set NAME=` (remove)
- [x] `%USERNAME%` `%USERPROFILE%` `%TEMP%` `%PATH%` and any other variable, in any command
- [x] `systeminfo` · `ver` · `hostname` · `whoami`
- [x] `help` · `help <command>` · `<command> /?` for all 25 commands
- [x] Collapsible "Quick Reference Cheat Sheet" sidebar: 5 collapsible groups, 73 clickable examples built from the same table as `help`; a click runs the command

## 5. Technical constraints

- [x] ~~Single `index.html`~~ → three files (`index.html`, `style.css`, `script.js`) on Seif's request; still no dependencies
- [x] Separate classes: `VFS`, `CommandParser` (variables, redirection, arguments), `Shell` (state + running commands, no page access), `Terminal` (everything on screen)
- [!] Possible missing constraint — the original spec text ends at a bare `-`. Waiting on Seif to confirm nothing was cut off.

## 6. Verification

- [x] `node test.js` — checks every command and error path listed above, and runs all 73 cheat-sheet examples in order on a fresh session
- [x] Headless Chrome via DevTools protocol — boot, typing, history, caret, `prompt`, `cls`, `title`, `color`, sidebar, every Settings control, settings surviving a reload, reset, mobile layout, zero uncaught page errors (throwaway script, not kept in the repo)
- [ ] Tried by hand in Firefox / Safari / on a real phone

## Not built, or removed for simplicity

| Item | State | Why | Add when |
|---|---|---|---|
| `rmdir /s` asking `Are you sure (Y/N)?` | Removed | Needed a whole "waiting for an answer" mode in Shell and Terminal | Realism matters more than short code |
| `fc` showing context and handling inserted lines | Simplified | Now compares line N with line N; one inserted line makes all later lines "differ" | Files with insertions need comparing |
| `findstr` patterns (`^ $ . *`) and wildcard file names | Removed | Words are matched as plain text | Asked for |
| `where` searching `%PATH%` (`where notepad`) | Removed | Spec only asks for current folder and `/R` | Asked for |
| Aliases `md`, `rd`, `chdir`, `erase`; `find /v`; `del /f`, `/a`; `%CD% %DATE% %TIME% %RANDOM%` | Removed | Extras beyond the spec | Asked for |
| Seeded files keeping a fixed "install" date | Removed | They now show the time the page was opened | Asked for |
| Pipes `\|`, `&`/`&&` chaining, `<`, `2>` | Never built | Spec asks only for `>` and `>>` | A lesson needs `dir \| find` |
| `ren`, `move`, `xcopy`, `date`, `time`, `exit` | Never built | Not in the spec's command list | Asked for |
| Tab completion of file names | Never built | Not in the spec | Asked for |
| Saving the file system between visits | Never built | Spec says in-memory; refresh = reset (only Settings are saved) | Students need to keep work |

## Next step

Seif opens `index.html`, tries the Settings panel and `prompt`, and says whether any removed item should come back.
