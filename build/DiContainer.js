"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
let _diContainers = [];
let _logger = {
  debug() {}

};

class DiContainer {
  constructor({
    logger,
    load
  }) {
    this.logger = logger || _logger;
    this.locatorRefDict = {};
    this.loadDict = load || {};
    this.loading = false;
    this.loadPromises = {};

    _diContainers.push(this);
  }

  async loadAll(injectionDict) {
    if (this.loading) {
      if (!injectionDict) {
        return this.loading;
      } else {
        throw new Error('TODO Need to implement this loading queue feature');
      }
    }

    this.loading = true;
    injectionDict = injectionDict || {};
    this.loadDict = { ...this.loadDict,
      ...injectionDict
    };

    for (let refName in this.loadDict) {
      this.logger.debug('loading :', refName);

      try {
        await this.getLoadPromise(refName);
      } catch (err) {
        this.logger.debug(`DiContainer:loadAll(${refName}):load error occured in .load()`, err);
        throw err;
      }
    }

    this.loading = false;
    return this.loading;
  }

  addToLoadDict(injectionDict) {
    if (this.loading) {
      throw new Error('Cannot add to load dict when loading');
    }

    injectionDict = injectionDict || {};
    this.loadDict = { ...this.loadDict,
      ...injectionDict
    };
  }

  addToLoadingPromisesIfNotAlreadyThere(refName, promise) {
    if (this.loadingPromises.hasOwnProperty(refName)) {
      return false;
    }

    this.loadingPromises[refName] = promise;
    return true;
  }

  async deepLocateDeps(locateDeps) {
    this.logger.debug(`+++++++DiContainer:deepLocateDeps(locateDeps):locateDeps begin: `, locateDeps);
    const deps = Array.isArray() && [] || {};

    for (let key in locateDeps) {
      const depNameOrNested = locateDeps[key];
      this.logger.debug(`DiContainer:deepLocateDeps(locateDeps): inside for key: `, key, ' depNameOrNested : ', depNameOrNested);

      try {
        let dep = typeof depNameOrNested !== 'string' ? await this.deepLocateDeps(depNameOrNested) : await this.get(depNameOrNested);
        this.logger.debug(`DiContainer:deepLocateDeps(locateDeps): inside for key: `, key, ' resolved dep : ', dep);
        deps[key] = dep;
      } catch (err) {
        this.logger.debug(`DiContainer:deepLocateDeps(${depNameOrNested}):locateDeps error occured in .get()`, err);
        throw err;
      }

      this.logger.debug(`DiContainer:deepLocateDeps(locateDeps): inside for key: `, key, ' resolved DEPS : ', deps[key]);
    }

    this.logger.debug(`========DiContainer:deepLocateDeps(locateDeps): END:  resolved DEPS : `, deps);
    return deps;
  }

  mergeObjects(a, b) {
    if (Array.isArray(a) || Array.isArray(b) || typeof a === 'string' || typeof b === 'string' || typeof a === 'function' || typeof b === 'function') {
      return [a, b];
    }

    const bCopy = { ...b
    };
    const keysIntersection = [];
    const bComplement = {};

    for (let key in a) {
      if (b.hasOwnProperty(key)) {
        keysIntersection.push(key);
      } else {
        bComplement[key] = a[key];
      }
    }

    for (let key of keysIntersection) {
      bCopy[key] = this.mergeObjects(a[key], b[key]);
    }

    const merged = { ...bComplement,
      ...bCopy
    };
    return merged;
  }

  async load(refName) {
    this.logger.debug('DiContainer:Loading: ', refName);

    if (this.has(refName)) {
      this.logger.debug('DiContainer:Already loaded: ', refName);
      return this.get(refName);
    }

    if (!this.loadDict.hasOwnProperty(refName)) {
      throw new Error('DiContainer:load() attempting to load inexistent ref', refName);
    }

    const el = this.loadDict[refName];
    let me = null;
    let {
      destructureDeps
    } = el;
    let locateDeps = null;
    let providedDeps = null;

    if (el.hasOwnProperty('deps')) {
      providedDeps = el.deps;
      destructureDeps = destructureDeps || Array.isArray(providedDeps);
    }

    if (el.hasOwnProperty('locateDeps')) {
      locateDeps = await this.deepLocateDeps(el.locateDeps);
      destructureDeps = destructureDeps || Array.isArray(locateDeps);
    }

    let deps = null;

    if (destructureDeps) {
      if (!Array.isArray(providedDeps)) {
        providedDeps = providedDeps && Object.values(providedDeps) || [];
      }

      if (!Array.isArray(locateDeps)) {
        locateDeps = locateDeps && Object.values(locateDeps) || [];
      }

      deps = [...locateDeps, ...providedDeps];
    } else {
      deps = this.mergeObjects(locateDeps || {}, providedDeps || {});
    }

    if (el.hasOwnProperty('before')) {
      let ret = null;

      try {
        ret = await el.before({
          deps,
          serviceLocator: this,
          el
        });
      } catch (err) {
        this.logger.debug(`DiContainer:load(${refName}):before error occured in .before()`, err);
        throw err;
      }

      if (ret !== undefined) {
        deps = ret;
      } else {
        this.logger.debug(`DiContainer:load(${refName}):before your .before() is returning undefined as deps is it on purpose?`, err);
      }
    }

    if (el.hasOwnProperty('injectable')) {
      this.logger.debug(`DiContainer:load(${refName}):inject injectable deps`, deps);

      try {
        await el.injectable.inject(deps);
      } catch (err) {
        this.logger.debug(`DiContainer:load(${refName}):inject error occured in .inject()`, err);
        throw err;
      }

      me = el.injectable;
    }

    if (el.hasOwnProperty('constructible')) {
      this.logger.debug(`DiContainer:load(${refName}):inject constructible deps`, deps);

      if (destructureDeps) {
        this.logger.debug(`DiContainer:load(${refName}):inject constructible destructureDeps`, deps);
        me = new el.constructible(...deps);
      } else if (Object.keys(deps).length) {
        this.logger.debug(`DiContainer:load(${refName}):inject constructible deps keys length`, deps);
        me = new el.constructible(deps);
      } else {
        this.logger.debug(`DiContainer:load(${refName}):inject constructible no destructure no keys length`, deps);
        me = new el.constructible();
      }

      this.logger.debug(`DiContainer:load(${refName}):inject constructible deps`, deps, me);
    }

    if (el.hasOwnProperty('factory')) {
      this.logger.debug(`DiContainer:load(${refName}):inject factory deps`, deps);

      if (destructureDeps) {
        this.logger.debug(`DiContainer:load(${refName}):inject factory destructureDeps`, deps);
        me = el.factory(...deps);
      } else if (Object.keys(deps).length) {
        this.logger.debug(`DiContainer:load(${refName}):inject factory deps keys length`, deps);
        me = el.factory(deps);
      } else {
        this.logger.debug(`DiContainer:load(${refName}):inject factory no destructure no keys length`, deps);
        me = el.factory();
      }

      this.logger.debug(`DiContainer:load(${refName}):inject factory deps`, deps, me);
    }

    if (el.hasOwnProperty('instance')) {
      me = el.instance;
    }

    if (el.hasOwnProperty('after')) {
      let ret;

      try {
        ret = await el.after({
          me,
          serviceLocator: this,
          el,
          deps
        });
      } catch (err) {
        this.logger.debug(`DiContainer:load(${refName}):after error occured in .after()`, err);
        throw err;
      }

      if (ret !== undefined) {
        me = ret;
      }
    }

    return this.set(refName, me);
  }

  async get(refName) {
    this.isValidRefNameOrThrow(refName);

    if (!this.has(refName)) {
      try {
        await this.getLoadPromise(refName);
      } catch (err) {
        this.logger.debug(`DiContainer:get(${refName}):load error occured in .load()`, err);
        throw err;
      }
    }

    return this.locatorRefDict[refName];
  }

  getLoadPromise(refName) {
    if (!this.loadDict.hasOwnProperty(refName)) {
      throw new Error(`Trying to access inexistent ref: ${refName} available refs are: ${Object.keys(this.locatorRefDict).join('\n')}`);
    }

    if (!this.loadPromises.hasOwnProperty(refName)) {
      const promise = this.load(refName);
      this.loadPromises[refName] = promise;
    }

    return this.loadPromises[refName];
  }

  set(refName, val) {
    this.isValidRefNameOrThrow(refName);

    if (this.has(refName)) {
      this.logger.debug('Replacing existent ref: ', refName);
    }

    this.locatorRefDict[refName] = val;
    return val;
  }

  has(refName) {
    this.isValidRefNameOrThrow(refName);
    this.logger.debug('DiContainer:has(', refName, ')', Object.keys(this.locatorRefDict));
    return this.locatorRefDict.hasOwnProperty(refName);
  }

  isValidRefNameOrThrow(refName) {
    if (typeof refName !== 'string') {
      throw new Error('Can only reference locatables by strings: ', refName);
    }
  }

  async emit(eventName, ...params) {
    let listener = null;

    for (let refName in this.loadDict) {
      listener = this.loadDict[refName];
      if (!listener.hasOwnProperty(eventName)) continue;

      if (typeof listener[eventName] !== 'function') {
        throw new Error(`Listener with ref: ${refName} of event ${eventName}, must have a callable ${eventName} function as prop`);
      }

      this.logger.debug('emitting :', eventName, 'on ref:', refName);

      try {
        await listener[eventName]({
          serviceLocator: this,
          params
        });
      } catch (err) {
        this.logger.debug(`DiContainer:emit('${eventName}'):call:error on ${refName}`, err, listener);
        throw err;
      }
    }
  }

  static inject({
    logger
  }) {
    _logger = logger;
  }

  static getLatestContainer() {
    return DiContainer.getNthContainer(_diContainers.length);
  }

  static getFirstContainer() {
    return DiContainer.getNthContainer(1);
  }

  static getNthContainer(n) {
    if (!(n > 0 && _diContainers.length >= n)) {
      throw new Error('Out of range');
    }

    return _diContainers[n - 1];
  }

  static getContainers() {
    return _diContainers;
  }

}

var _default = DiContainer;
exports.default = _default;