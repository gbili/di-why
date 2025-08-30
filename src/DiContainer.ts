import { deepLocateDeps } from "./utils/deepLocateDeps";
import { mergeObjects } from "./utils/mergeObjects";

export interface LoggerInterface {
  debug: (...params: any[]) => any;
}
export interface InjectableInterface {
  inject: (...args: any[]) => any;
}

export type SubscriberCallbackParams = {
  serviceLocator: DiContainer;
  params: any[];
};

export type SubscriptionsDict = {
  [k: string]: (param: SubscriberCallbackParams) => any;
};

export type GetInstanceType<C> = C extends new(...args: any[]) => infer T ? T : never;
export type GetInjectableSubclass<T> = T extends InjectableInterface ? T : never;
export type AfterCallbackProps<T, D = DependenciesDict> = { me: T, serviceLocator: DiContainer, el: LoadDictElement<T>, deps: D };
export type BeforeCallbackProps<T, D = DependenciesDict> = { serviceLocator: DiContainer, el: LoadDictElement<T>, deps: D };

export type ConstructibleProp<T> = { constructible: new(...args: any[]) => T; }
export type InstanceProp<T> = { instance: T; }
export type InjectableProp<T> = { injectable: GetInjectableSubclass<T>; }
export type FactoryProp<T> = { factory: (...args: any[]) => T; }

type LdePropsUnion<T> = {}
  & ConstructibleProp<T>
  & InstanceProp<T>
  & InjectableProp<T>
  & FactoryProp<T>

type LdeXOR<T, K extends keyof LdePropsUnion<T>> = Pick<LdePropsUnion<T>, K> & Omit<Partial<LdePropsUnion<T>>, K>

type Common<T, D = DependenciesDict, BD = Partial<D>> = {}
  & { deps?: D, }
  & { destructureDeps?: boolean; }
  & { locateDeps?: LocatableNestedDependenciesDict; }
  & { after?: (props: AfterCallbackProps<T, D>) => (T | void | Promise<T | void>); }
  & { before?: (props: BeforeCallbackProps<T, BD>) => (D | void | Promise<D | void>); }
  & { subscriptions?: SubscriptionsDict; }

export type LoadDictElement<T = any, D = DependenciesDict, BD = Partial<D>> = {}
  & (
    LdeXOR<T, "constructible">
    | LdeXOR<T, "instance">
    | LdeXOR<T, "injectable">
    | LdeXOR<T, "factory">
) &
  Common<T, D, BD>;

export type LoadDict = {
  [P: string]: LoadDictElement;
};

export type LoadPromisesDict = {
  [k: string]: Promise<any>;
};

export type ServiceLocatorDict = {
  [k: string]: any;
};

export type LocatableServicesDict = {
  [k: string]: string;
};

export type DependenciesDict = ServiceLocatorDict;

export type LocatableNestedDependenciesDict = {
  [k: string]: string | LocatableNestedSubDependenciesDict;
};

export type LocatableNestedSubDependenciesDict = {
  [k: string]: string | LocatableNestedSubDependenciesDict;
} | {
  [i: number]: string | LocatableNestedSubDependenciesDict;
}

let _diContainers: DiContainer[] = [];

class DiContainer {
  public logger: LoggerInterface;
  public locatorRefDict: ServiceLocatorDict = {};
  public loadDict: LoadDict = {};
  public loading: boolean = false;
  public loadPromises: LoadPromisesDict = {};

  constructor({ logger, load }: { logger?: LoggerInterface; load?: LoadDict } = {}) {
    this.logger = logger || { debug: () => undefined };
    if (load) {
      this.loadDict = { ...load };
    }
    _diContainers.push(this);
  }

  /**
   * Loads all entries in the load dictionary (optionally merged with an injection dictionary).
   */
  async loadAll(injectionDict?: LoadDict) {
    if (this.loading) {
      if (!injectionDict) {
        return this.loading;
      } else {
        throw new Error('Loading queue feature not implemented.');
      }
    }
    this.loading = true;
    injectionDict = injectionDict || {};
    this.loadDict = { ...this.loadDict, ...injectionDict };
    for (const refName of Object.keys(this.loadDict)) {
      this.logger.debug('Loading:', refName);
      try {
        await this.getLoading(refName);
      } catch (err) {
        this.logger.debug(`Error loading ${refName}:`, err);
        throw err;
      }
    }
    this.loading = false;
    return this.loading;
  }

  /**
   * Adds new entries to the load dictionary.
   */
  addToLoadDict(injectionDict: LoadDict) {
    if (this.loading) {
      throw new Error('Cannot add to load dict while loading');
    }
    injectionDict = injectionDict || {};
    this.loadDict = { ...this.loadDict, ...injectionDict };
  }

  /**
   * Adds a loading promise if one does not exist yet.
   */
  addToLoadingPromisesIfNotAlreadyThere(refName: string, promise: Promise<any>) {
    if (this.isLoading(refName)) {
      return false;
    }
    this.loadPromises[refName] = promise;
    return true;
  }

  /**
   * Loads a single entry by its refName.
   */
  async load(refName: string) {
    this.logger.debug('Loading:', refName);
    if (this.hasLoaded(refName)) {
      this.logger.debug('Already loaded:', refName);
      return this.get(refName);
    }
    if (!this.couldLoad(refName)) {
      throw new Error(`Attempting to load nonexistent ref "${refName}"`);
    }
    const el = this.loadDict[refName];
    let instance: any = null;
    let { destructureDeps } = el;
    let locateDeps = null;
    let providedDeps = null;

    if (el.deps) {
      providedDeps = el.deps;
      destructureDeps = destructureDeps || Array.isArray(providedDeps);
    }
    if (el.locateDeps) {
      try {
        locateDeps = await deepLocateDeps(this, el.locateDeps);
        destructureDeps = destructureDeps || Array.isArray(locateDeps);
      } catch (err) {
        this.logger.debug(`Error in deepLocateDeps for "${refName}":`, err);
        throw err;
      }
    }

    let deps: any;
    if (destructureDeps) {
      const providedArray = Array.isArray(providedDeps)
        ? providedDeps
        : providedDeps
          ? Object.values(providedDeps)
          : [];
      const locateArray = Array.isArray(locateDeps)
        ? locateDeps
        : locateDeps
          ? Object.values(locateDeps)
          : [];
      deps = [...locateArray, ...providedArray];
    } else {
      deps = mergeObjects(locateDeps || {}, providedDeps || {});
    }

    if (el.before) {
      try {
        const ret = await el.before({ serviceLocator: this, el, deps });
        if (ret !== undefined) {
          deps = ret;
        } else {
          this.logger.debug(`Before hook for "${refName}" returned undefined; using existing deps.`);
        }
      } catch (err) {
        this.logger.debug(`Error in before hook for "${refName}":`, err);
        throw err;
      }
    }

    if (el.injectable) {
      this.logger.debug(`Injecting dependencies into injectable for "${refName}":`, deps);
      try {
        await el.injectable.inject(deps);
      } catch (err) {
        this.logger.debug(`Error injecting dependencies for "${refName}":`, err);
        throw err;
      }
      instance = el.injectable;
    } else if (el.constructible) {
      this.logger.debug(`Instantiating constructible for "${refName}" with deps:`, deps);
      if (destructureDeps) {
        instance = new el.constructible(...deps);
      } else if (Object.keys(deps).length) {
        instance = new el.constructible(deps);
      } else {
        instance = new el.constructible();
      }
    } else if (el.factory) {
      this.logger.debug(`Creating instance using factory for "${refName}" with deps:`, deps);
      if (destructureDeps) {
        instance = el.factory(...deps);
      } else if (Object.keys(deps).length) {
        instance = el.factory(deps);
      } else {
        instance = el.factory();
      }
    } else if (el.instance) {
      instance = el.instance;
    } else {
      throw new Error(`No valid instantiation method provided for "${refName}"`);
    }

    if (el.after) {
      try {
        const ret = await el.after({ me: instance, serviceLocator: this, el, deps });
        if (ret !== undefined) {
          instance = ret;
        }
      } catch (err) {
        this.logger.debug(`Error in after hook for "${refName}":`, err);
        throw err;
      }
    }

    return this.setLoaded(refName, instance);
  }

  /**
   * Returns the loaded instance for a given refName.
   */
  async get<T = any>(refName: string): Promise<T> {
    if (!this.hasLoaded(refName)) {
      try {
        await this.getLoading(refName);
      } catch (err) {
        this.logger.debug(`Error loading "${refName}":`, err);
        throw err;
      }
    }
    return this.locatorRefDict[refName];
  }

  /**
   * Returns the promise responsible for loading a given refName.
   */
  getLoading(refName: string): Promise<any> {
    if (!this.couldLoad(refName)) {
      throw new Error(
        `Ref "${refName}" does not exist. Available refs: ${Object.keys(this.locatorRefDict).join(', ')}`
      );
    }
    if (!this.isLoading(refName)) {
      this.loadPromises[refName] = this.load(refName);
    }
    return this.loadPromises[refName];
  }

  isLoading(refName: string): boolean {
    return refName in this.loadPromises
  }

  /**
   * Stores the loaded instance under its refName.
   */
  setLoaded(refName: string, value: any) {
    if (this.hasLoaded(refName)) {
      this.logger.debug(`Replacing existing ref: "${refName}"`);
    }
    this.locatorRefDict[refName] = value;
    return value;
  }

  /**
   * Checks whether an instance has already been loaded.
   */
  hasLoaded(refName: string) {
    return refName in this.locatorRefDict;
  }

  couldLoad(refName: string) {
    return refName in this.loadDict;
  }

  /**
   * Emits an event by invoking all subscription callbacks on the load dictionary.
   */
  async emit(eventName: string, ...params: any[]) {
    for (const [refName, listener] of Object.entries(this.loadDict)) {
      if (!listener.subscriptions || typeof listener.subscriptions[eventName] !== 'function') {
        continue;
      }
      this.logger.debug(`Emitting event "${eventName}" on ref: "${refName}"`);
      try {
        await listener.subscriptions[eventName]({ serviceLocator: this, params });
      } catch (err) {
        this.logger.debug(`Error emitting event "${eventName}" on "${refName}":`, err);
        throw err;
      }
    }
  }

  static getLatestContainer() {
    return DiContainer.getNthContainer(_diContainers.length);
  }

  static getFirstContainer() {
    return DiContainer.getNthContainer(1);
  }

  static getNthContainer(n: number) {
    if (!(n > 0 && _diContainers.length >= n)) {
      throw new Error('Container index out of range');
    }
    return _diContainers[n - 1];
  }

  static getContainers() {
    return _diContainers;
  }
}

export default DiContainer;
