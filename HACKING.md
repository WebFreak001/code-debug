# Working on code-debug itself

This file is a work in progress to start gathering the information, ["take with
a grain of salt"][grain_of_salt_idiom] and please: contribute.

[grain_of_salt_idiom]: https://en.wikipedia.org/wiki/Grain_of_salt

## Various Targeted Versions

|  Item   |      Version       |
| :-----: | :----------------: |
|   DAP   | Current - 6 months |
| Node.js |        16.x        |
|   npm   |        18.x        |

- [DAP]: We should attempt to stay compatible with at least a 6-month old
  version of the specification. This allows those projects which integrate DAP,
  time to adjust to newer releases of the specification. The DAP
  [changelog][dap_changelog] can be referenced to determine when a specific
  functionality was implemented.
- [Node.js]/[npm]: Currently developers should target the use of the above
  versions. This allows generated files created by these tools (e.g.,
  `package-lock.json`) to remain consistent in their versioning.

[node.js]: https://nodejs.org/
[npm]: https://www.npmjs.com/
[dap]: https://microsoft.github.io/debug-adapter-protocol
[dap_changelog]: https://microsoft.github.io/debug-adapter-protocol/changelog

## Tool Installation

### Windows

We assume that VSCode is already installed as described on the [Microsoft Setup
page][vscode_setup_windows].

[vscode_setup_windows]: https://code.visualstudio.com/docs/setup/windows

#### Support Packages (Windows)

- [git][git_releases]
- [nodejs/npm][nodejs_download]
  - When installing Node.js, you will be prompted to install "Tools for Native
    Modules". Although is not necessary that this be selected (as no modules
    used by the extension require native compilation), it is advisable that this
    be selected in case that changes in the future. Make sure the "Automatically
    install the necessary tools" is check-marked so that needed compilers are
    installed as part of the Windows Node.js installation.
- Compilers/Debuggers

  - Since Chocolatey was installed in the previous step, we can use that to
    install MinGW and LLVM
  - MinGW: `gcc`, `gdb`, `gdbserver`

    ```shell
    choco install mingw --yes
    ```

  - LLVM: `clang`, `lldb-mi`, `lldb-server`

    - Note: Newer versions of LLVM (i.e., newer than 9.0.1) don't ship with
      `lldb-mi` (see release notes [here][llvm_release_notes])
    - Note: It appears that `lldb-server` was not shipped until 10.0.0, so
      installing an older version which contained `lldb-mi` means we wouldn't
      have `lldb-server`.
    - **TODO**: Work around this by installing the latest version of LLVM and
      then building `lldb-mi` from source.
    - For now, we must install an older version of LLVM if we wish to use the
      packaged `lldb-mi` executable.

      ```shell
      choco install llvm --version=9.0.1
      ```

  - The D language debugger `mago-mi` is only available for Windows and is
    installed as part of the VisualD package.
    - [VisualD]
    - **TODO**: Complete installation instructions
  - Optional build tools

    ```shell
    choco install make --yes
    choco install cmake --installargs 'ADD_CMAKE_TO_PATH=System' --yes
    ```

These packages will likely install into "C:\ProgramData\chocolatey\bin" and
"C:\Program Files\LLVM\bin", but the PATH should be updated so you don't really
need to know where they are. You may need to open a new console after installing
so that your PATH is updated appropriately.

[git_releases]: https://github.com/git-for-windows/git/releases/latest
[nodejs_download]: https://nodejs.org/en/download/
[llvm_release_notes]:
  https://releases.llvm.org/9.0.1/docs/ReleaseNotes.html#changes-to-lldb
[visuald]: http://rainers.github.io/visuald/visuald/StartPage.html

#### OpenSSH (Windows)

In order to exercise and test the SSH portion of the extension it is necessary
for an SSH server and client to be installed. Follow the suggested documentation
provided by Microsoft for the [OpenSSH Installation][openssh_install].

```powershell
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'
```

[openssh_install]:
  https://docs.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse

### Ubuntu 20.04/WSL

These instructions can mostly be used interchangeably for installing on a native
Ubuntu installation or on Windows using Windows Subsystem for Linux (WSL). If
installing for WSL, you'll first need to activate that in Windows as described
on the [Microsoft Install WSL page][wsl_install].

```powershell
wsl --install
```

Additionally, there are multiple ways to run VSCode within the WSL. If you have
a Windows 11/WSLg installation, that can run native applications directly.
Another option would be to run Windows 10/WSL + X Server. This would require
running a display manager in Windows (e.g., `VcXsrv`) to display the X
applications running in the Linux subsystem. Yet another options, would be to
run a VSCode server on the WSL side with the Windows VSCode application acting
as the UI. This third option requires a "Remote Development" extension pack be
installed in the Windows VSCode and the details of the setup are discussed
[here][wsl_remote_tutorial].

Prior to performing any installation under Linux/WSL, it is advised to update
and upgrade the packages as necessary:

```shell
sudo apt update
sudo apt --assume-yes upgrade
```

For a dedicated Linux installation (i.e., not under WSL), we assume VSCode is
already installed as described on the [Microsoft Setup
page][vscode_linux_setup].

```shell
curl --silent --location http://go.microsoft.com/fwlink/?LinkID=760868 >~/Downloads/code.deb
sudo apt --assume-yes install ~/Downloads/code.deb
```

For a WSL installation, running `code .` within the shell (as described
[here][wsl_run_vscode]), will find and install the VSCode Server for Linux.

The extension can be developed with other editors, but these instructions center
around an assumed VSCode installation. Even if VSCode isn't already installed,
the above should provide a guideline on how to pull it down and install the
package. Refer to the full documentation on the VSCode setup page previously
identified.

[wsl_install]: https://docs.microsoft.com/en-us/windows/wsl/install
[wsl_remote_tutorial]: https://code.visualstudio.com/docs/remote/wsl-tutorial
[wsl_run_vscode]:
  https://code.visualstudio.com/docs/remote/wsl-tutorial#_run-in-wsl
[vscode_linux_setup]: https://code.visualstudio.com/docs/setup/linux

#### Support Packages (Linux)

- git/Build Essentials

  - We'll need some basic tools, such at `git`, `nodejs`, `npm` for pulling the
    repository and installing/managing the extension's module dependencies.
    We'll install the packages necessary to ensure these tools are available on
    the machine.

    ```shell
    sudo apt --assume-yes install git build-essential
    ```

- nodejs/npm

  - At the time of this writing the latest version of Node.js/npm available from
    the default repositories in Ubuntu 20.04 is 14.x/6.x. We'll configure `apt`
    to use the NodeSource PPA for Node.js and npm to give us access to newer
    versions of those tools (i.e., 16.x and 8.x respectively).

    ```shell
    curl --silent --location https://deb.nodesource.com/setup_16.x | sudo bash -
    sudo apt --assume-yes install nodejs
    ```

- Compilers/Debuggers

  - We'll want to install the debuggers so that we can test out changes that we
    make (Note: `lldb-9` is the last version to ship with `lldb-mi`).

    ```shell
    sudo apt --assume-yes install gcc gdb gdbserver
    sudo apt --assume-yes install clang-9 lldb-9
    ```

#### OpenSSH (Linux/WSL)

```shell
sudo apt --assume-yes install openssh-server
```

##### SSH Configuration (WSL)

In addition to installing the SSH package, the OpenSSH server will need to be
started.

```shell
sudo service ssh start
```

By default, password authentication is not enabled. If you want to connect using
a password, you'll need to edit `/etc/ssh/sshd_config` (e.g.,
`sudo vim /etc/ssh/sshd_config`) and change `PasswordAuthentication` to `yes`.
After that, restart the ssh service (via `sudo service ssh restart`).

## Dependencies Installation

If you plan on submitting pull requests, you should first fork the main
repository and work off of that. In that case, use the location of your forked
repository instead of the main repository. If you only want to checkout changes
in the main repository, you can pull straight from there instead of needing to
fork your own.

Use the `clean-install` version of the `npm install` command. This installs the
exact versions that are identified in the package-lock.json file and won't
update the lockfile to newer versions. It should be expected that if a module
version is updated in package.json, then it should also be updated in
package-lock.json at the same time. Running `npm clean-install` instead of just
`npm install` will catch cases in which these two diverge instead of silently
updating package-lock.json as a result of the divergence. Using
`npm clean-install` also makes sure that all developers are using the exact same
version of the modules, which helps to eliminate any potential variability in
observed behavior.

In addition, you should also use the `--omit=optional` switch as part of the
package installation command. There are some modules (e.g., SSH2) which include
optional functionality that utilizes native code specific to the platform.
Currently, this extension does not require these platform-specific modules and
thus doesn't package native-specific releases. Optional packages should likely
be excluded from your installation in order to be more consistent with the
released extension (which does not bundle the optional packages).

The default behavior of the npm install procedure will install additional
modules used during development, so those will also be installed and available
for use as part of development activities, but will not be packaged with the
released extension.

```shell
git clone https://github.com/WebFreak001/code-debug
cd code-debug
npm clean-install --omit=optional
```

## Optional VSCode Extensions (for development)

If you use VSCode as your development platform, consider installing the
following packages to provide both code and documentation linting while you
edit. If the extensions are not installed, command line versions of the tools
are installed as part of the development environment. Tasks have been
established (in tasks.json) which can be used to run these checks manually. The
extensions provide more automation in that the checks will be performed
automatically while you edit, however they typically only run on the active file
in the editor, so it's still helpful to run the tasks (at least once prior to a
commit), as those tasks are configured to run against the entire project.

These same tools will be run during pull requests as well as a push to the main
repository. Thus, it is helpful to identify these issues during development
rather than after submitting a pull request. Note that pushing commits to your
local GitHub branch will automatically run these checks as well (since they are
specified in the GitHub Actions configuration), so they can still be performed,
even if these extensions are not used (or the command line tasks are not
executed), prior to submitting a pull request.

- ESLint
  - Perform TypeScript linting while you edit.
- Markdown Preview GitHub Styling
  - Preview GitHub style rendering of documentation.
- Prettier
  - Consistently format Markdown, including line wrapping (on save).
- markdownlint
  - Perform Markdown linting while you edit.
- Code Spell Checker
  - Perform spell checking of your documentation.
- Mocha Test Explorer
  - Extensive UI for running and debugging tests within VSCode.

## Workflow

### Compiling

There are a number of different ways the extension can be compiled. If you
perform any debugging, there is a "Pre-Launch" task that will compile the
extension prior to debugging, thus the compilation step may be automatically
performed for you. In addition, you can manually force a compilation using the
"compile" task, located in tasks.json.

The Typescript compiler (or more accurately transpiler) is configured to run in
"watch" mode when the "compile" task is executed (either directly, or indirectly
via the "Pre-Launch" task). There it continues to run in the background
monitoring for file changes and then automatically compiles those files. Due to
this behavior, it is usually not necessary to manual perform a compilation after
it has been performed in one of the above mentioned ways.

Yet another option is to perform the compilation from the command line. This is
the method that is performed during Continuous Integration (CI) to transpile the
source code into JavaScript. This can be performed in the project's root
directory by executing the following command. Note that the transpiler is not
invoked in "watch" mode, as the `-w` option is not supplied, so this just
compiles once and then exits.

```shell
tsc -p ./
```

### Running/Debugging

#### Running

In order to run the extension with your changes, you'll need to execute the
"Launch Extension" configuration. This will open up a second instance of VSCode
running your changes in this new instance. The VSCode documentation surrounding
setting up a mock debugger extension, as detailed [here][mock_debug_setup]
provides detailed documentation on how to run debugger extensions. You should
reference that information as it won't be repeated here.

#### Verbosity Settings

If you need to debug the extension, there are a few different options, depending
on what type of information is necessary to gain insight into an issue. The
extension comes with built-in diagnostics which can be enabled, as-is available
to any user of the extension (i.e., `showDevDebugOutput`, `printCalls`), which
is configured as part of the launch configuration. The `showDevDebugOutput`
provides details about backend communication between the debug adapter and the
actual debugger (e.g., `gdb`, `lldb-mi`) over the machine interface (MI). The
`printCalls` shows the calls that are made internally (typically at a higher
level) for incoming commands from the client (e.g., VSCode). This doesn't
provide extremely detailed debug information, but is often useful in diagnosing
many issues.

#### Internal Tracing

Internally, there is a "trace" option in the backend MI functionality (i.e.,
`mi2.ts`) which can be used (set the "trace" boolean to "true") to activate
additional logging which has been previously added to that package. If the
problem exists in the MI2 class, this can provide additional insight. You can
add additional calls to the logging functionality as needed to help you diagnose
a problem.

#### Debugger

For debugging more serious problems (such as an exception occurring in the
extension itself), it may be useful to run the debug adapter itself within the
debugger. Debug Adapter extensions run as a process separate from VSCode, so you
have to perform some additional setup in order to debug them. Similar to the
"Launch Extension" documented above, this will consist of running two separate
VSCode instances.

From the first/main instance you will run both the "Launch Extension" to launch
the secondary VSCode instance (which is the same as was described above). In
addition you will need to run the "code-debug server" launch configuration. This
"code-debug server" configuration will launch the debug adapter and also
provides it with the special option `--server=4711`, causing it to be configured
to communicate over the specified port number. Additionally, this launched debug
adapter is run in the debugger of the first VSCode instance. You can set
breakpoints or other conditions that you want to investigate in the debug
adapter source code as you would any other source that you'd attempt to debug.

**Note:** there is a convenience compound launch configuration "Extension
Debugging (Extension + Debug Server)" which runs both of these for you so you
don't have to start them separately.

From the second VSCode instance, you will need to change the launch
configuration for the application you want to run to use the `debugServer`
attribute. The port number that you specify must match the port number that was
used to configure the debug adapter, mentioned in the previous section (i.e.,
`"debugServer": 4711`). Other than that, run the application to debug as you
would normally and exercise the scenario that causes the debug adapter to
trigger the problem. If this works as expected, you'll likely see that the
breakpoint you set in the first VSCode instance will have triggered and you can
then debug the debug adapter from the first VSCode instance.

For additional details on this approach, a good reference is the example used
for debugging a mock debug adapter as shown on the VSCode site, found
[here][mock_debug_setup].

#### Packet Sniffing

So far, we've seen a bit about diagnosing problems on the backend between the
debug adapter and the debuggers themselves, but there doesn't currently exist
much support for debugging issues between the debug adapter and the
client/editor. However, even with the lack of built-in trace capability, we can
easily examine the communication between the two using a packet sniffer, such as
Wireshark.

In order to perform this packet sniffing, we must configure the debug adapter as
a server, as described in the previous section, so that it's communication
occurs over a TCP/IP port, rather than via the normal stdin/stdout interface.
Assuming that configuration, Wireshark should be configured to sniff traffic on
the local loopback interface (i.e., "Loopback: lo"). Additionally, it is good to
add a filter to just show the packets that we're interested in, based on the
port number: `tcp.port == 4711`.

With Wireshark configured as described, just start a debug session as described
in the previous section and exercise the debug adapter as needed to cover the
scenario you want to observe in the tracing. Once you are satisfied that you've
captured the necessary information, you can use the "follow stream" to have
Wireshark assemble the packets into a coherent series of messages exchanges. In
order to see these combined messages, just select "Analyze > Follow > TCP
Stream" within Wireshark. This will reassemble the packets and provide an easily
readable format that should be easy to understand based on the DAP
specification.

[mock_debug_setup]:
  https://code.visualstudio.com/api/extension-guides/debugger-extension#development-setup-for-mock-debug

### Linting

If using VSCode and you've installed the optional extensions, linting should
occur as you make changes to the project. However, prior to committing a change
it is useful to run a lint of the entire project in case something has escaped
being noticed. For Typescript, ESLint is used as the linting program and can be
run against the project by invoking the "npm:lint" task. There is also an
"npm:lint-fix" task which will also correct Typescript linting issues that can
automatically be corrected. Additionally, if using the ESLint extension, further
configuration can be made so that issues which can be automatically corrected
are performed when the file is saved. This is not the default setting, as it
might be considered overly aggressive, however if you do decide to add
additional tweaks, it is suggested to save them in your own user settings,
rather than the workspace-specific settings.

For documentation linting, Markdown linting, spellchecking and document
formatting are performed. These are located in the "npm:spellcheck-markdown",
"npm:lint-markdown" and "npm:prettier-write-docs" tasks. Again, these checks
should be performed while you edit (or on save for the document formatting) if
you've installed the optional extensions previously mentioned.

If these steps are not performed, linting will be performed in your own
repository when you push your changes back to GitHub (assuming you forked the
main repository). Additionally, the checks will also be run for any pull
requests to the main repository. Thus, issues with linting should be caught at
one of these downstream checks, but it is usually beneficial to catch the
problems earlier so that they can be addressed at that point in time, without
creating additional rework on you.

### Testing

#### Unit Testing

There currently are a small set of unit tests which exist and are exercised as
part of CI when pull requests or commits are made to the main repository branch.
At the very least, you should make sure that your changes don't cause a
regression in these tests. For new functionality, consider adding to this unit
test suite to enhance the coverage of the tests. If the software is implemented
with high cohesion and low coupling, this should lead to modular software units
which lend themselves well to unit testing.

The current test suite is implemented using the [Mocha] test framework. The
existing tests can be run from within VSCode using "npm:test" task. Much better
integration is provided by the Mocha Test Explorer extension, so that is
recommended if you use VSCode for development, as you can run and debug tests
from using the built-in Text Explorer UI. The CI will run these tests against
Linux, Windows and MacOS as part of the testing strategy.

In addition, code coverage can be checked using the "npm:coverage" task. This
will provide useful statistics about how much of the code base has been covered
by the tests. Additionally, the CI actions for the main repository are connected
to [Codecov][codecov], so that information can also be seen directly from the
"coverage" badge in the README file. The expectation is that the coverage should
be increasing instead of decreasing, thus it is highly encouraged to provide
tests with pull requests in order to keep the code base from moving in the wrong
direction with respect to test coverage.

[mocha]: https://mochajs.org/
[codecov]: https://codecov.io/gh/WebFreak001/code-debug/branch/master

#### Integration Testing

Currently, there are no automated integration (i.e., end-to-end) tests. The
tests which are performed, are done manually by the developers. The desire is to
start to implement higher-level automated tests. There are many different
variations that need to be covered by a developer, such as different debuggers,
attach vs launch configurations, remote and extended remote applications, SSH
connections and also different Operating Systems that the debug adapter runs on.
Due to the number of permutations, it becomes difficult (and error prone) to
attempt to manually test all of these scenarios, let alone the amount of time
needed to perform these checks. Additionally, the checks are usually just
centered around the change that was made and therefore are not performing any
regression testing.

**TODO**: Look into the [Test Support][test_support] modules to see if they can
be used to develop higher level tests for the debug adapter. This module is a
sibling module to the others that are used by this DA (i.e., VSCode Debug
Protocol and Debug Adapter modules), so it may lend itself nicely for this
purpose. The test support modules are Mocha-based, so would also be consistent
with the unit testing framework currently in place.

[test_support]:
  https://github.com/microsoft/vscode-debugadapter-node/tree/main/testSupport

### Documentation

#### README

Changes in the user-observable behavior should be documented in the README. For
new functionality, this might require the addition of a new section or paragraph
describing this new behavior. For a change in behavior, it might mean updating
the corresponding section of the documentation (if it exists) to describe the
changed behavior. If documentation does not exist, but should exist, consider
adding this missing documentation.

#### CHANGELOG

Significant changes, especially those that would be observed by the user,
including bug fixes and new features, should be described by an entry in the
CHANGELOG. Thus, the CHANGELOG should be updated as part of the change itself.
Add the information into the CHANGELOG in the appropriate section, according to
the "Keep a Changelog" rules. If referencing the PR in the CHANGELOG, it may be
necessary to first create a pull request, then update the CHANGELOG after the
pull request has been created (to obtain the newly created PR number) and then
perform a "force push" of the updated CHANGELOG. If this is the first update
since a previous release, an "Unreleased" section should be added to the top of
the CHANGELOG where this change is being documented, if one doesn't already
exist. Similarly to how the change log shows the newest release sections first,
add your changelog entry to the top-most entry in the applicable subsection.
This continues the tradition of showing the newest changes at the top, in both
the subsections, as well as the individual release level.

#### Source Code

Consider adding comments in the source code where rationale behind certain
implementation details may not be obvious, to help others (and your future self)
understand the software.

#### Formatting

Some of the markdown documentation is being linted according to markdown linting
rules, while other documentation is being moved in that direction. Eventually,
all markdown documentation should conform to these rules. This helps ensure
quality and consistency between the developers contributing to the project.
Refer to the previously recommended extensions for help auditing your changes as
you make them, which will help to eliminate surprises when you attempt to
generate a pull request. The pull requests are run against these markdown
spelling and linting checks and will need to pass review prior to being accepted
into the code base.

### Adding Dependencies

When determining new package dependencies for the extension, it is necessary to
evaluate the licensing to make sure the desired package is license compatible
with this extension. This extension is released as "public domain" and thus any
package dependencies should support a license which is compatible with this
extension's license.

Additionally, when package dependencies are changed, both package.json and
package-lock.json should be updated at the same time (to stay synchronized).
Furthermore, it is suggested that developers use `npm clean-install` to install
the necessary packages. This is useful for 2 reasons. If the versions between
the 2 files are not consistent, the tool will exit with an error. So this
provides a check to make sure they stay synchronized. Furthermore, this makes
sure that each developer is working with the exact same versions of these
packages. This can help to reduce potential issues related to problems
discovered in newer versions of packages.

Dependencies which are strictly for use during development (i.e., development
dependencies) and thus not shipped with the release do not need to contain
compatible licensing, as they are not considered part of the product. They
should also be installed using the `--save-dev` option of the `npm install`
command (e.g., `npm install <package> --save-dev`), such that the dependencies
are associated only with development and not production. This can be reviewed by
examining the package.json and looking at the `dependencies` and
`devDependencies` sections.

## Generating a Release

### Creating Package Locally

Prior to performing the release, it's good to first create the package locally
to make sure there are no hidden issues that were non-obvious. In order to do
this, you can create the package and then check it's contents. The package is a
zip archive which can be extracted and inspected. You should check to make there
aren't additional files in the archive which do not belong there. If there are
additional files, the `.vscodeignore` should be updated to list those files (or
directories) so they don't appear in the package. Recreate the package again to
verify that those files have been removed. The updated `.vscodeignore` should be
committed to the repository.

```shell
npx vsce package
```

By default, the naming convention will be `debug-<VERSION>.vsix`, where the
VERSION is pulled from the "version" attribute in package.json. This filename
can be changed by specifying the `--out` option and providing a different name
(e.g., `npx vsce package --out debug-test.vsix`) if desired. This may help to
keep track that this is just a test build of the archive rather than the
official released package.

In addition to creating the package locally, you can also install the package
and test the extension with VSCode. There are multiple ways to install an
extension manually, so referring directly to the VSCode documentation to
[Install from a VSIX][install_from_a_vsix] is the best way to learn how to use
this method.

[install_from_a_vsix]:
  https://code.visualstudio.com/docs/editor/extension-marketplace#_install-from-a-vsix

### Updating the version

Prior to release, the release version will need to be updated. This version
number resides in multiple locations: package.json, package-lock.json and
CHANGELOG.md.

**Note**: When performing the actual release, there will be a check to make sure
the versions are consistent between these 3 files as well as the tag used to
create the release.

The version number should be updated according to the [Semantic
Versioning][semantic_versioning] rules regarding MAJOR, MINOR and PATCH versions
based on the backwards compatibility or breaking changes of the software that is
to be released with respect to previous versions.

- A version starting with major version 0 means breaking changes may be
  introduced with the minor version.
- Bump the minor version every time, no matter if there are breaking changes
  until we reach 1.0.0.
- In 1.0.0 we declare full stability and no longer break stuff with updates.

[semantic_versioning]: https://semver.org/

#### Updating package.json/package-lock.json version

The version can be updated manually in these files, but it is recommended to use
the built-in `npm` command instead. While using the `npm` command, you'll want
to make sure that it doesn't attempt to generate a commit or create a tag as
part of this update, as you will be doing that manually as part of the release
on GitHub. In order to prevent this, use the `--no-git-tag-version` switch with
this command. In the following command, substitute VERSION with the actual
version which is to be used (e.g., 0.26.1).

```shell
npm version VERSION --no-git-tag-version
```

#### Update CHANGELOG.md version

The Changelog is based on ideas from [Keep a Changelog][keep_a_changelog] and
thus follows the document structuring and section headings as described there.
At this point in time, it is useful to check for any omissions from the
changelog, for changes made during this release cycle, and to add them if
needed. Also, check to make sure the entries in the changelog appear in the
correct sections (e.g., Added, Changed, Deprecated, etc).

**Note**: There will possibly be a CI action to check this, for thoughts about
it see [this discussion][changelog_discussion].

The changelog must be updated to replace the "Unreleased" section identifier
with the version of this forthcoming release. In addition, there is a commit
compare link which the section header links to. With an unreleased build, this
is a comparison of HEAD against the previously released version. Now that we are
actually going to be creating the release, the commit comparison should be
between the tags of the two different versions instead of HEAD. Currently the
version tag does not exist for this release, as it will be created in the next
step. However, we can insert the version tag here knowing what it will be, in
anticipation of that step. See examples of comparison links for previously
released versions in this file for examples on how to format the link.

[keep_a_changelog]: https://keepachangelog.com
[changelog_discussion]:
  https://github.com/WebFreak001/code-debug/pull/345#discussion_r857586174

### Triggering the Release Action

At this point, any changes that were necessary due to the ignore file or version
changes should have been made and those changes committed and pushed to the main
repository. The steps in this section will be performed on the GitHub user
interface. The release action is not setup to trigger on a tag being pushed to
the repository and instead is manually triggered by "drafting a new release" on
the [release page][release_page].

On the release page, select "Draft New Release". On the "Choose a tag"
drop-down, enter the new non-existent tag (e.g., v0.26.1). Entering a
non-existent tag will tag the HEAD of the repository with this version. For the
"Release Title", just use the same version name. For the description of the
release, it is probably most appropriate to just point at the Changelog, so as
to not have to duplicate information found there. A description such as "See
CHANGELOG.md for release details." is sufficient. Adding a link to the changelog
is also helpful.

At this point, pushing the "Publish release" button should trigger the release
action. This will perform the version consistency check between the tag version
and the package.json, package-lock.json and CHANGELOG.md. The release will fail
if these are not all consistent. Assuming those are consistent, the application
is built, packaged and published to multiple places. The package will be
published to both the [VS Marketplace][vs_marketplace] as well as the [Open VSX
Registry][open_vsx_registry]. Finally, the VSIX file is also published on the
GitHub release page, so that it can be manually installed by users if they
desire.

[release_page]: https://github.com/WebFreak001/code-debug/releases
[vs_marketplace]:
  https://marketplace.visualstudio.com/items?itemName=webfreak.debug
[open_vsx_registry]: https://open-vsx.org/extension/webfreak/debug

### Post-Release Activities

After a successful release, it is helpful to "reset" for the next release. The
changelog can be updated to add a new "Unreleased" section. If this is not done
after a release is performed, it can be performed on the first commit targeting
this future release. In addition, make sure to add a new comparison link for the
release which compares the previously released version against HEAD.

Additionally, it might be helpful to bump the version number, possibly by
incrementing the patch-version and adding "-alpha.1" (the marketplaces don't
support that, but for a local checkout and build this is quite useful).
