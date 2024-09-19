# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog], and this project adheres to [Semantic
Versioning].

[keep a changelog]: https://keepachangelog.com/en/1.0.0
[semantic versioning]: https://semver.org/spec/v2.0.0.html

## Unreleased

### Added

- fix missing output of variable type for structure ([@henryriley0])
- add static variable support ([@henryriley0])
- fix gdb check error when debug beginning ([@henryriley0])
- fix implicitly type error in log message when build vsix ([@henryriley0])
- check for configured debugger before start to provide a nicer error message
  ([@GitMensch])
- New `frameFilters` option for GDB that allows using custom frame filters,
  enabled by default ([@JacquesLucke])
- Suppress error for hover as the user may just play with the mouse ([@oltolm]).
- solve the problem of failed parsing of containers ([@henryriley0])
- Fixes #421 - Added `registerLimit` option to specify the registers to
  display - PR #444 ([@chenzhiy2001])

## [0.27.0] - 2024-02-07

### Added

- Added registers view ([@nomtats]) #242
- Enabled breakpoints inside `riscv` files ([@William-An]) #404

[0.27.0]: https://github.com/WebFreak001/code-debug/compare/v0.26.1...v0.27.0

## [0.26.1] - 2022-12-31

### Fixed

- Fixes #387 - Updated documentation for running as `sudo` ([@GitMensch])
- Fixes #236 - Documentation indicates that multi-threaded debugging is not
  supported ([@brownts])
- Fixes #381 - POSIX relative paths in SSH `sourceFileMap` were not properly
  formatted ([@brownts])
- Fixes #348 - Not waiting for `autorun` commands to complete before continuing
  execution ([@brownts])
- Fixes #382 - Breakpoints not always cleared over SSH - PR #383
  ([@abussy-aldebaran])
- Fixes #305 - Added updates for HACKING and documentation linting ([@brownts],
  [@GitMensch])
- Fixes #322 - replace deprecated `substr` ([@GitMensch])
- Fixes #332 - "go to cursor location" does not work with ssh `sourceFileMap`
  ([@GitMensch])
- Partially fixes #347 - Add github automated unit testing and linting - PR #354
  ([@brownts])
- Fixes #346 - Case-sensitivity not respected in SSH path mapping - PR #352
  ([@brownts])
- Fixes #342 - Local variables not displayed more than 2 stack frames deep - PR
  #345 ([@brownts])

[0.26.1]: https://github.com/WebFreak001/code-debug/compare/v0.26.0...v0.26.1

## [0.26.0] - 2022-04-16

### Added

- Resolves #298 - New `ssh.sourceFileMap` configuration to allow multiple
  substitutions between local and ssh-remote and separate ssh working
  directory - PR #323 ([@GitMensch])
- Resolves #265 - allow specification of port/x11port via variable (as numeric
  string) ([@GitMensch])
- New `stopAtEntry` configuration to run debugger to application's entry point -
  PR #306 ([@brownts])
- Github Action added for production releasing ([@WebFreak001], [@brownts])
- Resolves #244 - New `stopAtConnect` configuration - PR #299, #302 ([@brownts])

### Changed

- vscode dependency was increased from 1.28 to 1.55 along with the debug-adapter
  protocol to get rid of some outdated dependencies ([@GitMensch])
- SSH2 module updated from deprecated 0.8.9 to current 1.6.0, allowing
  connections with more modern key algorithms, improved error handling
  (including user messages passed on) and other improvements. ([@GitMensch])
  - See [SSH2 Update Notices] for more details.
- `cwd` changed to required property ([@WebFreak001])

### Fixed

- Fixes #329 - Attaching to local PID now performs initialization prior to
  attaching - PR #341 ([@brownts])
- Fixes #339 - Fix MI parser to allow async-record w/o a result - PR #340
  ([@brownts])
- Fixes #206 - Extra debugger arguments now work in all configurations - PR
  #316, #338 ([@GitMensch], [@brownts])
- Fix path type detection for differing remote path type - PR #334 ([@brownts])
- Fixes #298 - fix path translation for SSH to Win32 and for extended-remote
  without executable (attach to process) - PR #323 ([@GitMensch])
- Fixes #308 - fix stack frame expansion in editor via use of the `startFrame`
  parameter - PR #312 ([@brownts])
- Fixes #277 - prevent "Not implemented stop reason (assuming exception)" in
  many cases, initial recognition of watchpoints ([@GitMensch])
- Fixes #307 - fix additional race conditions with setting breakpoints - PR #313
  ([@brownts])
- Fixes #230 - Breakpoints may be deleted when not recognized correctly - PR
  #259 ([@kvinwang])
- Fixes #303 - fix for race conditions on startup where breakpoints were not
  hit - PR #304 ([@brownts])
- Set as a default debugger for all supported languages - PR #281 ([@reznikmm])
- Fixes #293, #294 - Path Substitutions working with attach+ssh, LLDB and
  Windows-Style paths - PR #295 ([@brownts])
- Fixes #278 - Add quotation marks around the variable name to support spaces -
  PR #279 ([@martin-fleck-at])
- Fixes #282 - Ensure we send error response for threads request - PR #283
  ([@martin-fleck-at])
- Stop using `enableBreakpointsFor` in package.json - PR #280 ([@reznikmm])

[ssh2 update notices]: https://github.com/mscdex/ssh2/issues/935
[0.26.0]: https://github.com/WebFreak001/code-debug/compare/v0.25.1...v0.26.0

## [0.25.1] - 2021-06-14

### Fixed

- Remove the need for extra trust for debugging workspaces per guidance "for
  debug extensions" as noted in the [Workspace Trust Extension Guide] - PR #272
  ([@GitMensch])
- don't abort if `set target-async` or `cd` fails in attach (brings in line with
  existing behavior from launch) ([@WebFreak001])
- Fix simple value formatting list parsing with empty string as first argument -
  PR #239 ([@nomtats])

[workspace trust extension guide]:
  https://github.com/microsoft/vscode/issues/120251#issuecomment-825832603
[0.25.1]: https://github.com/WebFreak001/code-debug/compare/v0.25.0...v0.25.1

## [0.25.0] - 2020-05-20

### Added

- Resolves #210 - Improve thread names on embedded GDB, makes not all threads
  always have the same name ([@anshulrouthu], [@WebFreak001])
- Support up to 65535 threads instead of 256 threads - PR #227 ([@ColdenCullen])
- Add support for path substitutions (`{"fromPath": "toPath"}`) for GDB and
  LLDB - PR #221 ([@karljs])

[0.25.0]: https://github.com/WebFreak001/code-debug/compare/v0.24.0...v0.25.0

## [0.24.0] - 2019-12-19

### Added

- Implement "Jump to Cursor" to skip instructions - PR #177 ([@ntoskrnl7],
  [@WebFreak001])
- Resolves #188 - Added zig as supported language ([@evangrayk], [@WebFreak001])

### Fixed

- Fixes #199 - Fix memory dump for theia ([@WebFreak001])
- Fix example Debug Microcontroller template ([@WebFreak001])

[0.24.0]: https://github.com/WebFreak001/code-debug/compare/v0.23.1...v0.24.0

## [0.23.1] - 2019-04-03

### Fixed

- Fixes #174 - Added kotlin to language list ([@WebFreak001])
- Fixes #173 - Breakpoints in SSH in other working directories properly resolved
  ([@WebFreak001])
- Fixes #175 - Undefined/null paths don't crash stacktrace ([@WebFreak001])

[0.23.1]: https://github.com/WebFreak001/code-debug/compare/v0.23.0...v0.23.1

## [0.23.0] - 2019-03-19

### Added

- Resolves #158 - New Examine memory Location UI ([@WebFreak001])

### Changed

- Project code improvements - PR #150, #151 ([@simark])
- Initial configurations contain valueFormatting now - PR #149 ([@Yanpas])

### Fixed

- Fixes #170 - Normalize file paths in stack trace ([@WebFreak001])
- Fixes #171 - Breakpoints in SSH on windows fixed - PR #172 ([@HaronK])

[0.23.0]: https://github.com/WebFreak001/code-debug/compare/v0.22.0...v0.23.0

## [0.22.0] - 2018-03-21

### Added

- Additional Fortran Language Ids - PR #138 ([@rafmudaf])
- Resolves #134 - Support for using SSH agent - PR #136 ([@JelleRoets])
- Resolves #36 - Support multi-threading - PR #129 ([@LeszekSwirski])
- Breakpoint support for Fortran90 - PR #130 ([@eamousing])

### Fixed

- Fixed GDB expansion logic with floats - PR #128 ([@Marus])
- Fixed attach to PID template - PR #126 ([@gentoo90])

[0.22.0]: https://github.com/WebFreak001/code-debug/compare/v0.21.2...v0.22.0

## [0.21.2] - 2017-07-23

### Fixed

- Icon fix and changelog update ([@WebFreak001])

[0.21.2]: https://github.com/WebFreak001/code-debug/compare/v0.21.1...v0.21.2

## [0.21.1] - 2017-07-23

### Fixed

- Enabled breakpoints for crystal - PR #111 ([@faustinoaq])

[0.21.1]: https://github.com/WebFreak001/code-debug/compare/v0.21.0...v0.21.1

## [0.21.0] - 2017-07-23

### Fixed

- Several fixes to variable pretty printers - PR #109 ([@gentoo90])

[0.21.0]: https://github.com/WebFreak001/code-debug/compare/v0.20.0...v0.21.0

## [0.20.0] - 2017-05-26

### Added

- Added support for pretty printers in variable list, enable with
  `"valuesFormatting": "prettyPrinters"` if you have a pretty printer to get
  potentially improved display of variables. - PR #107 ([@gentoo90])

[0.20.0]: https://github.com/WebFreak001/code-debug/compare/v0.19.0...v0.20.0

<!-- Contributors listed alphabetically -->

[@abussy-aldebaran]: https://github.com/abussy-aldebaran
[@anshulrouthu]: https://github.com/anshulrouthu
[@brownts]: https://github.com/brownts
[@chenzhiy2001]: https://github.com/chenzhiy2001
[@coldencullen]: https://github.com/ColdenCullen
[@eamousing]: https://github.com/eamousing
[@evangrayk]: https://github.com/evangrayk
[@faustinoaq]: https://github.com/faustinoaq
[@gentoo90]: https://github.com/gentoo90
[@gitmensch]: https://github.com/GitMensch
[@haronk]: https://github.com/HaronK
[@henryriley0]: https://github.com/HenryRiley0
[@jacqueslucke]: https://github.com/JacquesLucke
[@jelleroets]: https://github.com/JelleRoets
[@karljs]: https://github.com/karljs
[@kvinwang]: https://github.com/kvinwang
[@leszekswirski]: https://github.com/LeszekSwirski
[@martin-fleck-at]: https://github.com/martin-fleck-at
[@marus]: https://github.com/Marus
[@nomtats]: https://github.com/nomtats
[@ntoskrnl7]: https://github.com/ntoskrnl7
[@rafmudaf]: https://github.com/rafmudaf
[@reznikmm]: https://github.com/reznikmm
[@simark]: https://github.com/simark
[@webfreak001]: https://github.com/WebFreak001
[@william-an]: https://github.com/William-An
[@yanpas]: https://github.com/Yanpas

<!-- markdownlint-configure-file { "MD024": { "siblings_only": true } } -->
