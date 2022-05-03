# Working on code-debug itself

This file is a work in progress to start gathering the information, "take with salt" and please: contribute.

## Pre-Requisites

node.js installation, at least N.N.N
vscode running

## Setup

```sh
git clone URL
npm install
```
done?

## Debug

Debugging extensions run on a separate process in vscode, so you can't debug them using the extension debugger directly.
What _is_ possible is to debug the debug-server on a special port and then attach to this by explicit specifying
the `debugServer` in the launch configuration of a second vscode instance.

To ease this you can launch the `Extension Debugging (Extension + Debug Server)` configuration which will start both
the debug-server on port 4711 and a new vscode instance with the debug extension enabled.
To debug both sides use a launch configuration in this instance after adding `"debugServer": 4711` to it.

## Unit tests

Add whenever possible. Possibly will be run soon by CI.
Can be run locally by ???, and also via Debug with the `Launch Tests` configuration.

For bigger tests (so far no work was put into this):

> Debug extensions implement the debug adapter protocol, so you could just simulate a debug app
> running this extension and validate which commands are sent/received.
> There are probably already libraries and applications for this out there on the internet.

## Creating a new vsix (locally())

Possibly:
```sh
npm install vsce
vsce package
```

## Doing a new release:

Because of a GitHub action you can tag releases to make them release on vscode marketplace, openvsx and on the releases tab.
Make sure you bump the version of the package in package.json before releasing!

* note concerning version numbering:
  * we do follow [Semantic Versioning](https://semver.org/),
    a version starting with major version 0 means breaking changes may be introduced with the minor version
  * bump the minor version every time, no matter if there are breaking changes until we reach 1.0.0
  * in 1.0.0 we declare full stability and no longer break stuff with updates
* note concerning [CHANGELOG.md]:
   * the format is based on ideas from [Keep a Changelog](https://keepachangelog.com)
   * there will possibly be a CI action to check this, for thoughts about it see
     [this discussion](https://github.com/WebFreak001/code-debug/pull/345#discussion_r857586174)
* check version bump in package.json
* check [CHANGELOG.md] for missing entries, change "Unreleased" section to the new version
* possibly: sync package-lock.json and check in?
* tag + push --> actual release
* adjust [CHANGELOG.md], adding "Unreleased Header" section back in
* bump version number, possibly by incrementing the patch-version and adding "-alpha.1"
  (the marketplaces don't support that, but for a local checkout and build this is quite useful)
