# 0.25.0

(Released May 2020)

* Add support for path substitutions (`{"fromPath": "toPath"}`) for GDB and LLDB (@karljs)
* Support up to 65535 threads instead of 256 threads (@ColdenCullen)
* Improve thread names on embedded GDB, makes not all threads always have the same name (with @anshulrouthu)

# 0.24.0

* Added zig as supported language.
* Fix example Debug Microcontroller template
* Implement "Jump to Cursor" to skip instructions
* Fix memory dump for theia

# 0.23.1

Fixes:
* Breakpoints in SSH in other working directories properly resolved
* Undefined/null paths don't crash stacktrace
* Added kotlin to language list

# 0.23.0

(released March 2019)

* Normalize file paths in stack trace (fixes duplicate opening of files)
* New Examine memory Location UI
* Breakpoints in SSH on windows fixed (@HaronK)
* Project code improvements (@simark)
* Initial configurations contain valueFormatting now (@Yanpas)

# 0.22.0

(released March 2018)

* Support for using SSH agent
* Support multi-threading (@LeszekSwirski)
* Fixed GDB expansion logic with floats (Marcel Ball)
* Fixed attach to PID template (@gentoo90)

# 0.21.0 / 0.21.1 / 0.21.2

(0.21.2 is pushed without changes to hopefully fix vscode installation)

* Several fixes to variable pretty printers by @gentoo90
* Enabled breakpoints for crystal (@faustinoaq)

# 0.20.0

Added support for pretty printers in variable list (by @gentoo90), enable
with `"valuesFormatting": "prettyPrinters"` if you have a pretty printer
to get potentially improved display of variables.