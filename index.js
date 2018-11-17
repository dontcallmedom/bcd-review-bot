const http = require('http'),
      Octokat = require("octokat"),
      createHandler = require('github-webhook-handler'),
      EventEmitter = require('events').EventEmitter;

const bcdCompare = require('./bcd-compare');

let gh;

function run(config) {
  const handler = createHandler({ path: config.hookPath, secret: config.ghHookSecret, events: ["pull_request"] });

  const notifier = new EventEmitter();

  gh = new Octokat({ token: config.ghAuthToken });

  const app = http.createServer(function (req, res) {
    handler(req, res, function (err) {
      res.statusCode = 404;
      res.end('no such location');
    });
  }).listen(config.hookPort);

  app.notifier = notifier;

  handler.on('error', function (err) {
    console.trace('Error:', err.message);
  });

  handler.on('pull_request', function (event) {
    // Relevant actions: "opened", "synchronize"
    if (event.payload.action !== "opened" && event.payload.action !== "synchronize")  return;

    // list  files touched by pull request
    listFilesFromPR(event.payload)
    // pick the JSON ones that were modified or edited
      .then(files =>
            Promise.all(
              files.filter(f => f.filename.match(/\.json$/) && (f.status === 'modified' || f.status === 'added'))
              // look at diff in JSON objects
                .map(f => fetchDiff(f, event.payload.pull_request)
                     // identify which browsers get new non-null data
                     .then(identifyInScopeBrowsers)
                    )
        ))
      .then(results => {
        const browsers = new Set(results.reduce((a,b) => a.concat(b), []));
        // set browser-specific teams as assignee to pull request reviews
        return assignReviewers(event.payload, browsers).then(results => notifier.emit('done', results));
      }).catch((err) => {
        console.trace(err);
        notifier.emit('error', err);
      });
  });

  return app;
}

function listFilesFromPR(pr) {
  // TODO: manage multi-page results
  return gh.repos(pr.repository.owner.login, pr.repository.name).pulls(pr.pull_request.number).files.fetch({per_page:100}).then(({items: files}) => files);
}

// fetch a file from a given repo at a given commit
function fetchGhFile(repo, commit, filename) {
  return gh
    .repos(repo.owner.login, repo.name)
    .contents(filename).fetch({ref: commit})
    .then(jsonbuffer =>  JSON.parse(new Buffer(jsonbuffer.content, 'base64').toString('utf8')));
}

// fetch old and new version of a given file in a pull request
function fetchDiff(file, pr) {
  return Promise.all([
    (file.status === 'modified' ?
     // fetch version in parent commit
     fetchGhFile(pr.base.repo, pr.base.sha, file.filename) :
     new Promise((res, rej) => res({}))
    ),
    // fetch submitted new version
    fetchGhFile(pr.head.repo, pr.head.sha, file.filename)
  ]);
}


function identifyInScopeBrowsers([old, _new]) {
  const browsers = bcdCompare.checkDiff(old, _new);
  return browsers;
}

function assignReviewers(pr, browsers) {
  // TODO manage multi-page results
  return gh.orgs(pr.repository.owner.login).teams.fetch({per_page: 100})
    .then(({items: teams}) => {
      var valid_reviewers = [...browsers].map(b => b + "_reviewers").filter(n => teams.find(t => t.slug === n));
      // TODO add to existing reviewers rather than replace
      return gh.repos(pr.repository.owner.login, pr.repository.name)
        .pulls(pr.pull_request.number)
        .requestedReviewers.fetch()
        .then(reviewers => {
          const team_reviewers = [... new Set(reviewers.teams.map(t => t.slug).concat(valid_reviewers))];
          var review_request = {
            reviewers: reviewers.users.map(u => u.login),
            team_reviewers
          };
          return gh.repos(pr.repository.owner.login, pr.repository.name)
            .pulls(pr.pull_request.number)
            .requestedReviewers.create(review_request)
            .then(() => review_request);
        });
    });
}

module.exports.run = run;

if (require.main === module) {
  const app = run(require("./config.json"));
  app.notifier.on('done', results => {
    console.log('Setting reviewers to ' + JSON.stringify(results, null, 2));
  });
}
