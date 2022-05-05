# [Unreleased]
## Fixed
* Fixes #346 - Case-sensitivity not respected in SSH path mapping - PR #352 (@brownts)
* Fixes #342 - Local variables not displayed more than 2 stack frames deep - PR #345 (@brownts)
* Fixes #332 - "go to cursor location" does not work with ssh sourceFileMap (after @brownts)

[Unreleased]: https://github.com/WebFreak001/code-debug/compare/v0.26.0...HEAD

# [0.26.0] - 2022-04-16

* vscode dependency was increased from 1.28 to 1.55 along with the debug-adapter protocol to get rid of some outdated dependencies (@GitMensch)
* SSH2 module updated from deprecated 0.8.9 to current 1.6.0 (@GitMensch),
  allowing connections with more modern key algorithms, improved error handling (including user messages passed on) and other improvements.  
  See [SSH2 Update Notices](https://github.com/mscdex/ssh2/issues/935) for more details.
* Path Substitutions working with attach+ssh configuration #293 (@brownts)
* Path Substitutions working with LLDB #295 (@brownts)
* Path Substitutions working with Windows-Style paths #294 (@brownts)
* Breakpoints may be deleted when not recognized correctly #259 fixing #230 (@kvinwang)
* New `stopAtConnect` configuration #299, #302 (@brownts)
* New `stopAtEntry` configuration to run debugger to application's entry point #306 (@brownts)
* New `ssh.sourceFileMap` configuration to allow multiple substitutions between local and ssh-remote and separate ssh working directory #298 (@GitMensch)
* fix path translation for SSH to Win32 and for extended-remote without executable (attach to process) #323 (@GitMensch)
* fix for race conditions on startup where breakpoints were not hit #304 (@brownts)
* prevent "Not implemented stop reason (assuming exception)" in many cases #316 (@GitMensch),
  initial recognition of watchpoints
* fix additional race conditions with setting breakpoints #313 (@brownts)
* fix stack frame expansion in editor via use of the `startFrame` parameter #312 (@brownts)
* allow specification of port/x11port via variable (as numeric string) #265 (@GitMensch)
* Extra debugger arguments now work in all configurations #316, #338 fixing #206 (@GitMensch, @brownts)
* Attaching to local PID now performs initialization prior to attaching #341 fixing #329 (@brownts)

[0.26.0]: https://github.com/WebFreak001/code-debug/compare/v0.25.1...v0.26.0

# [0.25.1]

* Remove the need for extra trust for debugging workspaces per guidance "for debug extensions" as noted in the [Workspace Trust Extension Guide](https://github.com/microsoft/vscode/issues/120251#issuecomment-825832603) (@GitMensch)
* Fix simple value formatting list parsing with empty string as first argument (@nomtats)
* don't abort if `set target-async` or `cd` fails in attach (brings in line with existing behavior from launch)

[0.25.1]: https://github.com/WebFreak001/code-debug/compare/f2923480e45874324ca94badbe35c7ed80a5e172...v0.25.1

# [0.25.0]

(released May 2020)

* Add support for path substitutions (`{"fromPath": "toPath"}`) for GDB and LLDB (@karljs)
* Support up to 65535 threads instead of 256 threads (@ColdenCullen)
* Improve thread names on embedded GDB, makes not all threads always have the same name (with @anshulrouthu)

[0.25.0]: https://github.com/WebFreak001/code-debug/compare/5ac331e7b1e809a47de94fbbfdf389287dba7803...f2923480e45874324ca94badbe35c7ed80a5e172

# 0.24.0

* Added zig as supported language.
* Fix example Debug Microcontroller template
* Implement "Jump to Cursor" to skip instructions
* Fix memory dump for theia

[0.24.0]: https://github.com/WebFreak001/code-debug/compare/53b6c346f1bf5907a9d1fd5455fdc52f310d5355...5ac331e7b1e809a47de94fbbfdf389287dba7803

# [0.23.1]

Fixes:
* Breakpoints in SSH in other working directories properly resolved
* Undefined/null paths don't crash stacktrace
* Added kotlin to language list

[0.23.1]: https://github.com/WebFreak001/code-debug/compare/38d72bd1cc0aeeb1ed80424b145acaa713713a09...53b6c346f1bf5907a9d1fd5455fdc52f310d5355

# [0.23.0]

(released March 2019)

* Normalize file paths in stack trace (fixes duplicate opening of files)
* New Examine memory Location UI
* Breakpoints in SSH on windows fixed (@HaronK)
* Project code improvements (@simark)
* Initial configurations contain valueFormatting now (@Yanpas)

[0.23.0]: https://github.com/WebFreak001/code-debug/compare/628492ba6cb5971944dcf6417931d9fa2fe43c9b...38d72bd1cc0aeeb1ed80424b145acaa713713a09

# [0.22.0]

(released March 2018)

* Support for using SSH agent
* Support multi-threading (@LeszekSwirski)
* Fixed GDB expansion logic with floats (Marcel Ball)
* Fixed attach to PID template (@gentoo90)

[0.22.0]: https://github.com/WebFreak001/code-debug/compare/ef8245259ac808c1517b16be064f9663a879d86d...628492ba6cb5971944dcf6417931d9fa2fe43c9b

# 0.21.0 / 0.21.1 / 0.21.2

(0.21.2 is pushed without changes to hopefully fix vscode installation)

* Several fixes to variable pretty printers by @gentoo90
* Enabled breakpoints for crystal (@faustinoaq)

# 0.20.0

Added support for pretty printers in variable list (by @gentoo90), enable
with `"valuesFormatting": "prettyPrinters"` if you have a pretty printer
to get potentially improved display of variables.
