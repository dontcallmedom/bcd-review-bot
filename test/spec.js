const expect = require('expect.js');
const request = require('supertest');
const nock = require('nock');
const crypto = require('crypto');
const fs = require('fs');

const config = require('./config-test.json');
const server = require('../index');

// simplify debugging of missed nock requests
nock.emitter.on('no match', function(req, options, requestBody) {
  if (!req || req.hostname !== '127.0.0.1') {
    console.error("No match for nock request on " + JSON.stringify(req, null, 2));
  }
});

function emptyNock(cb) {
  return function(err) {
    expect(nock.pendingMocks()).to.be.empty();
    cb(err);
  }
}

const targetRepo = { name: "test", full_name: "test/test", owner: { login: "test" } };
const sourceRepo = { name: "test", full_name: "test2/test", owner: { login: "test2" } };

const testPrOpen = {
  repository: targetRepo,
  action: "opened",
  pull_request: {
    number: 5,
    title: "test PR",
    head: {
      sha: "fedcbafedcbafedcbafedcbafedcbafedcbafedc",
      repo: sourceRepo
    },
    base: {
      sha: "fedcbafedcbafedcbafedcbafedcbafedcbafeda",
      repo: targetRepo
    }
  }
};

const browserVersions = (obj) => {
  const ret = {};
  Object.keys(obj).forEach(browser => {
    ret[browser] = {
      version_added: obj[browser]
    }
  });
  return ret;
};

const createMockBcd = (path, data, subfeaturesdata = {}) => {
  const ret  = {};
  let keys = path.split('/');
  let obj = ret;
  while (keys.length) {
    const k = keys.shift();
    obj[k] = {};
    obj = obj[k];
  }
  Object.assign(obj,{
    __compat: {
      support: browserVersions(data)
    }
  });
  if (subfeaturesdata) {
    Object.keys(subfeaturesdata).forEach(sub => {
      obj[sub] = {
        __compat: {
          support: browserVersions(subfeaturesdata[sub])
        }
      };
    });
  }
  return ret;
};

const mockBcdChanges = {
  'api/PaymentAddress.json': {
    'fedcbafedcbafedcbafedcbafedcbafedcbafeda': createMockBcd('api/PaymentAddress', {chrome: false, firefox: 68}),
    'fedcbafedcbafedcbafedcbafedcbafedcbafedc': createMockBcd('api/PaymentAddress', {chrome: 45, firefox: 68}, {regionCode: {edge: 12, safari: false}})
  },
  "api/PaymentResponse.json": {
    'fedcbafedcbafedcbafedcbafedcbafedcbafeda': createMockBcd('api/PaymentAddress', {chrome: null, firefox: 68}),
    'fedcbafedcbafedcbafedcbafedcbafedcbafedc': createMockBcd('api/PaymentAddress', {chrome: null, firefox: 68})
  },
  "html/Supported_media_formats.json": {
    'fedcbafedcbafedcbafedcbafedcbafedcbafedc': createMockBcd('css/properties/background-color', {chrome_android: null, opera: 42})
  }
}

const encodeToGhContents = (obj) => { return {content: new Buffer(JSON.stringify(obj)).toString('base64'), encoding: 'base64'};};

const signGhPayload = function (buffer) {
  const algo = "sha1";
  const secret = config.ghHookSecret;
  return algo + "=" + crypto.createHmac(algo, secret).update(buffer).digest("hex");
};

describe('Server starts and responds to pull request events', function () {
  before(() => {
    http = server.run(config);
    req = request('http://127.0.0.1:' + config.hookPort);
  });

  it('reacts to pull requests notifications', function testPullRequestNotif(done) {
    const prFiles = JSON.parse(fs.readFileSync('./test/pr-files.json', 'utf-8'));

    nock('https://api.github.com')
      .get('/repos/' + testPrOpen.repository.full_name + "/pulls/" + testPrOpen.pull_request.number + "/files?per_page=100")
      .reply(200, {items: prFiles});
    prFiles.forEach(f => {
      if (f.status === 'modified') {
        nock('https://api.github.com')
          .get('/repos/' + testPrOpen.pull_request.base.repo.full_name + "/contents/" + f.filename + '?ref=' + testPrOpen.pull_request.base.sha)
          .reply(200, encodeToGhContents(mockBcdChanges[f.filename][testPrOpen.pull_request.base.sha]));
      }
      if (f.status === 'added' || f.status === 'modified') {
        nock('https://api.github.com')
          .get('/repos/' + testPrOpen.pull_request.head.repo.full_name + "/contents/" + f.filename + '?ref=' + testPrOpen.pull_request.head.sha)
          .reply(200, encodeToGhContents(mockBcdChanges[f.filename][testPrOpen.pull_request.head.sha]));
      }
    });

    nock('https://api.github.com')
      .get('/orgs/' + testPrOpen.repository.owner.login + "/teams?per_page=100")
      .reply(200, {items: [ { slug: "chrome_reviewers" } , { slug: "edge_reviewers" }, { slug: "safari_reviewers" } ]});

    nock('https://api.github.com')
      .get('/repos/' + testPrOpen.repository.full_name + "/pulls/" + testPrOpen.pull_request.number + "/requested_reviewers")
      .reply(200, { users: [ { login: 'testuser'} ] , teams: [ { slug: 'mdnstaff' } ] });

    nock('https://api.github.com')
      .post('/repos/' + testPrOpen.repository.full_name + "/pulls/" + testPrOpen.pull_request.number + "/requested_reviewers",
            { reviewers: ['testuser'], team_reviewers: [ 'mdnstaff', 'chrome_reviewers', 'edge_reviewers', 'safari_reviewers' ] })
      .reply(201);

    http.notifier.on('done', res => {
      expect(res.reviewers).to.have.length(1);
      expect(res.team_reviewers).to.have.length(4);
      done();
    });
    http.notifier.on('error', done);

    req.post(config.hookPath)
      .send(testPrOpen)
      .set('X-Github-Event', 'pull_request')
      .set('X-Github-Delivery', 'foo')
      .set('X-Hub-Signature', signGhPayload(new Buffer(JSON.stringify(testPrOpen))))
      .expect(200, function(err, res) {
        if (err) return done(err);
      });
  });

  after(function (done) {
    http.close(emptyNock(done));
  });

});
