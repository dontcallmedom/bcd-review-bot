const arrayEquals = (a1, a2) =>  a1.length === a2.length && a1.every(x => a2.findIndex(y => dataEquals(x, y)) >= 0);
const dataEquals = (d1, d2) => {
  if (Array.isArray(d1) && Array.isArray(d2)) return arrayEquals(d1, d2);
  if (typeof(d1) !== typeof(d2)) return false;
  if (d1 === null) return d1 === d2;
  if (typeof(d1) === "object") return arrayEquals(Object.keys(d1), Object.keys(d2)) && Object.keys(d1).every(k => dataEquals(d1[k], d2[k]));
  return d1 === d2;
};
const arrayIze = a => Array.isArray(a) ? a : [a];
const arrayOrStringEquals = (a1, a2) => arrayEquals(arrayIze(a1), arrayIze(a2));
const isNullData = o => {
  if (o === null) return true;
  if (Array.isArray(o)) return o.every(x => x === null);
  if (typeof o === "object") return Object.keys(o).length === 0 || Object.values(o).every(isNullData);
};

function checkFeatureDiff(old, _new) {
  let browsers = [];
  Object.keys(_new).forEach(browser => {
    const o = old[browser];
    const n = _new[browser];
    if (isNullData(n)) return;
    if (!dataEquals(o, n))
      browsers.push(browser);
  });
  return browsers;
}

const objectPathExists = (obj, path) => {
  path = [...path];
  if (!obj) return false;
  if (path.length === 0) return true;
  const first = path.shift();
  if (obj[first] === undefined) return false;
  return objectPathExists(obj[first], path);
}

const toPathInObject = (obj, path) => {
  let res = obj;
  path.forEach(p => {
    res = res[p];
  });
  return res;
}

function checkDiff(old, _new) {
  // find first single child who is a parent of __compat
  const featureRootPathSegments = [];
  let obj = _new;
  while(obj && Object.keys(obj).length === 1 && Object.keys(obj)[0] !== '__compat') {
    featureRootPathSegments.push(Object.keys(obj)[0]);
    obj = obj[Object.keys(obj)[0]];
  }
  if (!obj || !Object.keys(obj).includes('__compat'))
    return []; // not a JSON obj in the expected format, ignore

  const subpath = ['__compat', 'support'];
  const path = featureRootPathSegments.concat(subpath);
  if (!objectPathExists(_new, path))
    return []; // not in the expected format - let's ignore it
  let browsers = checkFeatureDiff(objectPathExists(old, path) ? toPathInObject(old, path) : {}, toPathInObject(_new, path));
  // TODO make recursive (for sub-sub feature etc)
  if (Object.keys(toPathInObject(_new, featureRootPathSegments)).length > 1) {
    Object.keys(toPathInObject(_new, featureRootPathSegments))
      .filter(k => k !== '__compat')
      .forEach(k => {
        if (!objectPathExists(_new, featureRootPathSegments.concat([k]).concat(subpath)))
          return; // invalid, we ignore
        browsers = browsers.concat(
          checkFeatureDiff(
            objectPathExists(old, featureRootPathSegments.concat([k]).concat(subpath)) ? toPathInObject(old, featureRootPathSegments.concat([k]).concat(subpath))  : {},
            toPathInObject(_new, featureRootPathSegments.concat([k]).concat(subpath)))
        );
      });
  }
  return browsers;
}

module.exports.checkDiff = checkDiff;
