# Browser Compat Data Review Bot

[MDN's Browser Compatibility Data](https://github.com/mdn/browser-compat-data) is maintained on github. To facilitate the review of changes to that data set, this node-based github Webhook assign teams of reviewers to any pull request based on the browsers the said pull request changes data about.

For instance, a pull request changing data on when a feature was added to the `chrome` browser will add the `chrome_reviewers` team to the reviewers of the said pull request.

# Install
`npm install`

# Configuration
`mv config.json.dist config.json`

`config.json` needs to be configured with the following properties:
* `hookPath`: the path at which the webhook will be served from (e.g. `"webhook"`)
* `hookPort`: the port on which the HTTP server will be publicly available
* `ghHookSecret`: the secret to be set in github when adding the hook (to validate the hook request did indeed come from github)
* `ghAuthToken`: a Github token used to assign reviewers on the repo

The Github token needs to have rights on the following scopes:
* `public_repo` (in `repo`) to be able to assign pull request reviews
* `read:org` (in `admin`) to get access to the list of teams for the org

The webhook so configured should be added to the `browser-compat-data` repository, with the following settings:
* Payload URL: the URL from which the hook is being served (including the `hookPath` defined above)
* Content type: **`application/json`** (NOT the default)
* Secret: the value of `ghHookSecret` defined above:
* Events triggering the webhook: Pull requests

The webhook will assign reviews to the team  _browser_`_reviewers` whenever a compat data touching a _browser_ entry is modified by the pull request. In particular, for any browser willing to help review a compat data, a _browser_`_reviewers` team should be created, populated with the right people, and be added to the repository as collaborator.

# Contributing
Uses [Octokat.js](https://github.com/philschatz/octokat.js/) to wrap the Github API.

There is a `mocha`/[`expect.js`](https://github.com/Automattic/expect.js/) test suite using [nock](https://github.com/nock/nock) to mock the github API.