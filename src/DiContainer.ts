export interface LoggerInterface {
  debug: (...params: any[]) => any;
}
export interface InjectableInterface {
  inject: (...args: any[]) => any;
}

export type SubscriberCallbackParams = {
  serviceLocator: DiContainer;
  params: any[];
}

export type SubscriptionsDict = {
  [k: string]: (param: SubscriberCallbackParams) => any;
}

export type GetInstanceType<C> = C extends new(...args: any[]) => infer T ? T : never;
export type GetInjectableSubclass<T> = T extends InjectableInterface ? T : never;
export type AfterCallbackProps<T> = { me: T, serviceLocator: DiContainer, el: LoadDictElement<T>, deps: DependenciesDict };
export type BeforeCallbackProps<T> = { serviceLocator: DiContainer, el: LoadDictElement<T>, deps: DependenciesDict };

export type LoadDictElement<T = any> = {
  constructible?: new(...args: any[]) => T;
  instance?: T;
  injectable?: GetInjectableSubclass<T>; 
  deps?: DependenciesDict,
  destructureDeps?: boolean;
  locateDeps?: LocatableNestedDependenciesDict,
  after?: (props: AfterCallbackProps<T>) => (T | void | Promise<T | void>);
  before?: (props: BeforeCallbackProps<T>) => (DependenciesDict | void | Promise<DependenciesDict | void>);
  factory?: (...args: any[]) => T;
  subscriptions?: SubscriptionsDict;
}

export type LoadDict = {
  [P: string]: LoadDictElement
}

export type LoadPromisesDict = {
  [k: string]: Promise<any>;
}

export type ServiceLocatorDict = {
  [k: string]: any;
}

export type DependenciesDict = ServiceLocatorDict;

export type LocatableNestedDependenciesDict = {
  [k: string]: string | LocatableNestedDependenciesDict;
}

let _diContainers: DiContainer[] = [];
let _logger: LoggerInterface = { debug: () => undefined };

class DiContainer {

  public logger: LoggerInterface;
  public locatorRefDict: ServiceLocatorDict;
  public loadDict: LoadDict;
  public loading: boolean;
  public loadPromises: LoadPromisesDict;

  constructor({ logger, load }: { logger?: LoggerInterface, load?: LoadDict}) {
    this.logger = logger || _logger;
    this.locatorRefDict = {};
    this.loadDict = load || {};
    this.loading = false;
    this.loadPromises = {};
    _diContainers.push(this);
  }

  async loadAll(injectionDict?: LoadDict) {
    if (this.loading) {
      if (!injectionDict) {
        return this.loading;
      } else {
        throw new Error('TODO Need to implement this loading queue feature');
      }
    }
    this.loading = true;
    injectionDict = injectionDict || {};
    this.loadDict = { ...this.loadDict, ...injectionDict };
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

  addToLoadDict(injectionDict: LoadDict) {
    if (this.loading) {
      throw new Error('Cannot add to load dict when loading');
    }
    injectionDict = injectionDict || {};
    this.loadDict = { ...this.loadDict, ...injectionDict };
  }

  addToLoadingPromisesIfNotAlreadyThere(refName: string, promise: Promise<any>) {
    if (this.loadPromises.hasOwnProperty(refName)) {
      return false;
    }
    this.loadPromises[refName] = promise;
    return true;
  }

  async deepLocateDeps(locateDeps: LocatableNestedDependenciesDict) {
    this.logger.debug(`+++++++DiContainer:deepLocateDeps(locateDeps):locateDeps begin: `, locateDeps);
    const deps: { [k in keyof LocatableNestedDependenciesDict]: any; } = (Array.isArray(locateDeps) && []) || {};
    for (let key in locateDeps) {
      const depNameOrNested = locateDeps[key];
      this.logger.debug(`DiContainer:deepLocateDeps(locateDeps): inside for key: `, key, ' depNameOrNested : ', depNameOrNested);
      try {
        let dep = (
          (typeof depNameOrNested !== 'string')
            ? await this.deepLocateDeps(depNameOrNested)
            : await this.get(depNameOrNested)
        );
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

  mergeObjects(a: any, b: any) {
    if (Array.isArray(a) || Array.isArray(b)
      || (typeof a === 'string' || typeof b === 'string')
      || (typeof a === 'function' || typeof b === 'function')
    ) {
      return [a, b];
    }
    const bCopy = {...b}
    const keysIntersection = [];
    const bComplement: { [k in keyof typeof a]: any } = {};
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
    const merged = {
      ...bComplement,
      ...bCopy
    };
    return merged;
  }

  async load(refName: string) {
    this.logger.debug('DiContainer:Loading: ', refName);
    if (this.has(refName)) {
      this.logger.debug('DiContainer:Already loaded: ', refName);
      return this.get(refName);
    }
    if (!this.loadDict.hasOwnProperty(refName)) {
      throw new Error(`DiContainer:load() attempting to load inexistent ref ${refName}`);
    }
    const el = this.loadDict[refName];
    let me = null;

    let { destructureDeps } = el;
    let locateDeps = null;
    let providedDeps = null;

    if (el.deps) {
      providedDeps = el.deps;
      destructureDeps = destructureDeps || Array.isArray(providedDeps);
    }
    if (el.locateDeps) {
      locateDeps = await this.deepLocateDeps(el.locateDeps);
      destructureDeps = destructureDeps || Array.isArray(locateDeps);
    }
    let deps = null;
    if (destructureDeps) {
      if (!Array.isArray(providedDeps)) {
        providedDeps = (providedDeps && Object.values(providedDeps)) || [];
      }
      if (!Array.isArray(locateDeps)) {
        locateDeps = (locateDeps && Object.values(locateDeps)) || [];
      }
      deps = [
        ...locateDeps,
        ...providedDeps,
      ];
    } else {
      deps = this.mergeObjects((locateDeps || {}), (providedDeps || {}));
    }

    if (el.before) {
      let ret = null;
      try {
        ret = await el.before({ serviceLocator: this, el, deps });
      } catch (err) {
        this.logger.debug(`DiContainer:load(${refName}):before error occured in .before()`, err);
        throw err;
      }
      if (ret !== undefined) {
        deps = ret;
      } else {
        this.logger.debug(`DiContainer:load(${refName}):before your .before() is returning undefined as deps is it on purpose?`);
      }
    }

    if (el.injectable) {
      this.logger.debug(`DiContainer:load(${refName}):inject injectable deps`, deps);
      try {
        await el.injectable.inject(deps)
      } catch (err) {
        this.logger.debug(`DiContainer:load(${refName}):inject error occured in .inject()`, err);
        throw err;
      }
      me = el.injectable;
    }

    if (el.constructible) {
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

    if (el.factory) {
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

    if (el.instance) {
      me = el.instance;
    }

    if (el.after) {
      let ret;
      try {
        ret = await el.after({ me, serviceLocator: this, el, deps });
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

  async get(refName: string) {
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

  getLoadPromise(refName: string) {
    if (!this.loadDict.hasOwnProperty(refName)) {
      throw new Error(`Trying to access inexistent ref: ${refName} available refs are: ${Object.keys(this.locatorRefDict).join('\n')}`);
    }

    if (!this.loadPromises.hasOwnProperty(refName)) {
      const promise = this.load(refName);
      this.loadPromises[refName] = promise;
    }

    return this.loadPromises[refName];
  }

  set(refName: string, val: any) {
    this.isValidRefNameOrThrow(refName);
    if (this.has(refName)) {
      this.logger.debug('Replacing existent ref: ', refName);
    }
    this.locatorRefDict[refName] = val;
    return val;
  }

  has(refName: string) {
    this.isValidRefNameOrThrow(refName);
    this.logger.debug('DiContainer:has(', refName, ')', Object.keys(this.locatorRefDict));
    return this.locatorRefDict.hasOwnProperty(refName);
  }

  isValidRefNameOrThrow(refName: string) {
    if (typeof refName !== 'string') {
      throw new Error(`Can only reference locatables by strings: ${refName}`);
    }
  }

  async emit(eventName: string, ...params: any[]) {
    for (let refName in this.loadDict) {
      const listener: { [k in keyof LoadDictElement ]: any } = this.loadDict[refName];
      if (!listener.subscriptions || !listener.subscriptions[eventName]) continue;
      const subscriberCallback = listener.subscriptions[eventName];
      if (typeof subscriberCallback !== 'function') {
        throw new Error(`Listener with ref: ${refName} of event ${eventName}, must have a callable ${eventName} function as prop`);
      }
      this.logger.debug('emitting :', eventName, 'on ref:', refName);
      try {
        await subscriberCallback({ serviceLocator: this, params});
      } catch (err) {
        this.logger.debug(`DiContainer:emit('${eventName}'):call:error on ${refName}`, err, listener);
        throw err;
      }
    }
  }

  static inject({ logger }: { logger: LoggerInterface }) {
    _logger = logger;
  }

  static getLatestContainer() {
    return DiContainer.getNthContainer(_diContainers.length);
  }

  static getFirstContainer() {
    return DiContainer.getNthContainer(1);
  }

  static getNthContainer(n: number) {
    if (!(n > 0 && (_diContainers.length >= n))) {
      throw new Error('Out of range');
    }
    return _diContainers[n-1];
  }

  static getContainers() {
    return _diContainers;
  }

}

export default DiContainer;
