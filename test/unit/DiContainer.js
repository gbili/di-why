import 'dotenv/config';
import chai from 'chai';
import { expect } from 'chai';
import logger from 'saylo';
import chaiAsPromised from 'chai-as-promised';
import DiContainer from '../../src/DiContainer';

chai.use(chaiAsPromised);
logger.turnOn('debug');

let helloInjection = null;
class Hello {
  constructor(injection) {
    this.injection = injection;
  }
  static inject(injection) {
    helloInjection = injection;
  }
  static getInjection() {
    return helloInjection;
  }
}

class HelloDestructureConstructorParams {
  constructor(param1, param2, param3) {
    this.param1 = param1;
    this.param2 = param2;
    this.param3 = param2;
  }
}

const data = { a: 1, b: "2", c: Hello, };
const data2 = { a: 1, b: "2", c: Hello, };
const data3 = { a: 1, b: "2", c: Hello, };
const data3Values = Object.values(data3);
let afterWasExecuted = false;

const stall = async function(stallTime = 3000) {
  await new Promise(resolve => setTimeout(resolve, stallTime));
};

class Hey {
  constructor({hey}) {
    this.hey = hey;
  }

  hoy(...params) {
    this.hoy = params;
  }
}

const injectionDict = {
  'Hello': {
    instance: Hello
  },
  'data': {
    instance: data,
    after: async ({me, serviceLocator, el}) => {
      await stall(200);
      afterWasExecuted = true;
    }
  },
  'Hey': {
    constructible: Hey,
    deps: { hey: 'hey' },
    onHoyEvent({ me, params }) {
      me.hoy(...params);
    }
  },
  'HelloObjDestructurableParams': {
    constructible: HelloDestructureConstructorParams,
    deps: data2,
    destructureDeps: true,
  },
  'HelloArrayDestructurableParams': {
    constructible: HelloDestructureConstructorParams,
    deps: data3Values,
  },
  'HelloBefore': {
    constructible: HelloDestructureConstructorParams,
    before: async ({ deps, serviceLocator }) => {
      const someDepNeedsToBePlacedInSpecialPlace = serviceLocator.get('HelloObjDestructurableParams');
      return deps.a = someDepNeedsToBePlacedInSpecialPlace;
    },
    deps: data3Values,
  },
  'HelloNestedLocateDepsColliding': {
    constructible: Hello,
    deps: {
      some: { nested: data2 }
    },
    locateDeps: {
      some: { nested: 'HelloObjDestructurableParams' }
    },
  },
  'HelloNestedLocateDepsNoCollide': {
    constructible: Hello,
    deps: {
      some: { nested: data2 }
    },
    locateDeps: {
      some: { otherNested: 'HelloObjDestructurableParams', moreNested: 'HelloNestedLocateDepsColliding' }
    },
  },
  'HelloNestedLocateDepsDifferentLocateAndDepsKeys': {
    constructible: Hello,
    deps: {
      some: { nested: data2 }
    },
    locateDeps: {
      other: { otherNested: 'HelloObjDestructurableParams', moreNested: 'HelloNestedLocateDepsColliding' }
    },
  },
  'emptyObject': {
    instance: {},
  },
  'logger': {
    instance: logger,
    after: async ({me, serviceLocator, el}) => {
      const data = await serviceLocator.get('data');
      serviceLocator.set('emptyObject', data);
    }
  },
  'HelloStaticInjectable': {
    injectable: Hello,
    deps: data,
    after: ({ me }) => (me.getInjection().d = 'd'),
  },
  'HelloConstructible': {
    constructible: Hello,
    deps: data,
    after: ({ me }) => (me.injection.e = 'e'),
  },
};

let bootstrapped = false;
describe(`DiContainer`, function() {

  before(async () => {
    bootstrapped = true;
  });

  it('bootstrapped properly', function () {
    expect(bootstrapped).to.be.equal(true);
  });

  describe(`DiContainer.getNthContainer(1)`, function() {
    it('should return an instance of DiContainer set at bootstrap', function() {
      const a = new DiContainer({ logger, load: injectionDict });
      new DiContainer({ logger, load: injectionDict });
      new DiContainer({ logger, load: injectionDict });
      expect(DiContainer.getNthContainer(1)).to.be.equal(DiContainer.getFirstContainer(1)).and.to.be.equal(a);
    });
  });

  describe(`DiContainer.getLatestContainer()`, function() {
    it('should return an instance of DiContainer set at bootstrap', function() {
      const d = new DiContainer({ logger, load: injectionDict });
      expect(DiContainer.getLatestContainer())
        .to.be.an.instanceof(DiContainer)
        .and.be.equal(d);
    });
  });

  describe(`DiContainer.mergeObjects(a, b)`, function() {
    it('should return an object with both merged (no collision)', function() {
      const di = new DiContainer({ logger });
      const o1 = {
        a1: {
          a2a: '-a2a'
        },
        b1: '-b1',
        d1: '-d1',
      };
      const o2 = {
        a1: {
          a2a: '_a2a',
          a2b: '_a2b'
        },
        b1: '_b1',
        c1: '_c1'
      };
      const expected = {
        a1: {
          a2a: ['-a2a', '_a2a'],
          a2b: '_a2b'
        },
        b1: ['-b1', '_b1'],
        c1: '_c1',
        d1: '-d1',
      };
      expect(di.mergeObjects(o1, o2)).to.be.deep.equal(expected);
    });
  });


  describe(`di.loadAll()`, function() {
    it('should be able to load :instance', async function() {
      const di = new DiContainer({ logger, load: injectionDict });
      expect(di.has('Hello')).to.be.equal(false);
      await di.loadAll();
      expect(di.has('Hello')).to.be.equal(true);
    });

    it('should be able to load :instance and execute after', async function() {
      afterWasExecuted = false;
      const di = new DiContainer({ logger, load: injectionDict });
      expect(di.has('data')).to.be.equal(false);
      await di.loadAll();
      expect(di.has('data')).to.be.equal(true);
      expect(afterWasExecuted).to.be.equal(true);
    });

    it('should be able to load :instance and give access to serviceLocator in after callback', async function() {
      const di = new DiContainer({ logger, load: injectionDict });
      expect(di.has('emptyObject')).to.be.equal(false);
      await di.loadAll();
      const lo = await di.get('logger');
      const eo = await di.get('emptyObject');
      expect(eo).to.be.equal(data);
    });

    it('should be able to load :injectable', async function() {
      const di = new DiContainer({ logger, load: injectionDict });
      expect(di.has('HelloStaticInjectable')).to.be.equal(false);
      await di.loadAll();
      expect(di.has('HelloStaticInjectable')).to.be.equal(true);
      expect(Hello.getInjection().d).to.be.equal('d');
    });

    it('should be able to load :constructible', async function() {
      const di = new DiContainer({ logger, load: injectionDict });
      expect(di.has('HelloConstructible')).to.be.equal(false);
      await di.loadAll();
      expect(di.has('HelloConstructible')).to.be.equal(true);
      const e = (await di.get('HelloConstructible')).injection.e;
      expect(e).to.be.equal('e');
    });

    it('should be able to load :constructible', async function() {
      const di = new DiContainer({ logger, load: injectionDict });
      expect(di.has('HelloConstructible')).to.be.equal(false);
      await di.loadAll();
      expect(di.has('HelloConstructible')).to.be.equal(true);
      const e = (await di.get('HelloConstructible')).injection.e;
      expect(e).to.be.equal('e');
    });

    it('should be able to load :constructible', async function() {
      const di = new DiContainer({ logger, load: injectionDict });
      expect(di.has('HelloObjDestructurableParams')).to.be.equal(false);
      await di.loadAll();
      expect(di.has('HelloObjDestructurableParams')).to.be.equal(true);
      const aaa = await di.get('HelloObjDestructurableParams');
      expect(aaa.param1).to.be.equal(data2.a);
      expect(aaa.param2).to.be.equal(data2.b);
    });
    it('should be able to load :constructible', async function() {
      const di = new DiContainer({ logger, load: injectionDict });
      await di.loadAll();
      const aaa = await di.get('HelloArrayDestructurableParams');
      expect(aaa.param1).to.be.equal(data3.a);
      expect(aaa.param2).to.be.equal(data3.b);
    });

    it('should be able to load :constructible with locateDeps and deps which have common deep nested properties', async function() {
      const di = new DiContainer({ logger, load: injectionDict });
      await di.loadAll();
      const aaa = await di.get('HelloNestedLocateDepsColliding');
      const dep = await di.get('HelloObjDestructurableParams');
      expect(aaa.injection).to.be.deep.equal({
        some: {
          nested: {...data2, ...dep}
        },
      });
    });

    it('should be able to load :constructible with locateDeps and deps which have common deep nested properties', async function() {
      const di = new DiContainer({ logger, load: injectionDict });
      await di.loadAll();
      const aaa = await di.get('HelloNestedLocateDepsNoCollide');
      const dep = await di.get('HelloObjDestructurableParams');
      const dep2 = await di.get('HelloNestedLocateDepsColliding');
      expect(aaa.injection).to.be.deep.equal({
        some: {
          nested: data2,
          otherNested: dep,
          moreNested: dep2,
        },
      });
    });

    it('should be able to load :constructible with locateDeps and deps which different deep nested properties', async function() {
      const di = new DiContainer({ logger, load: injectionDict });
      await di.loadAll();
      const aaa = await di.get('HelloNestedLocateDepsDifferentLocateAndDepsKeys');
      const dep = await di.get('HelloObjDestructurableParams');
      const dep2 = await di.get('HelloNestedLocateDepsColliding');
      expect(aaa.injection).to.be.deep.equal({
        some: {
          nested: data2,
        },
        other: {
          otherNested: dep,
          moreNested: dep2,
        }
      });
    });

  });


  describe(`di.get()`, function() {
    it('should be able to get an async loaded entry', async function() {
      afterWasExecuted = false;
      const di = new DiContainer({ logger, load: injectionDict });
      expect(di.has('data')).to.be.equal(false);
      await di.loadAll();
      expect(await di.get('data')).to.be.equal(data);
      expect(afterWasExecuted).to.be.equal(true);
    });
  });

  describe(`di.set()`, function() {
    it('should be able to set a non existent entry', async function() {
      const di = new DiContainer({ logger, load: injectionDict });
      expect(di.has('data')).to.be.equal(false);
      const key = 'nonExistent';
      const value = 'nonExistentValue';
      di.set(key, value);
      expect(await di.get(key)).to.be.equal(value);
    });

    it('should be able to set an existent entry', async function() {
      const di = new DiContainer({ logger, load: injectionDict });
      await di.loadAll();
      const key = 'data';
      expect(di.has(key)).to.be.equal(true);
      const value = 'new value';
      di.set(key, value);
      expect(await di.get(key)).to.be.equal(value);
    });
  });

  describe(`di.emit(<eventName>, <params>)`, function() {

    it('should call <eventName>(<params>) on each el of injectionDict implementing it, and pass me and params as first param', async function() {
      const injectionDict = {
        'Hey': {
          constructible: Hey,
          deps: { hey: 'hey' },
          async onHoyEvent({ serviceLocator, params }) {
            const me = await serviceLocator.get('Hey');
            me.hoy(...params);
          }
        },
      }
      const di = new DiContainer({ logger, load: injectionDict });
      const param1 = { hey: 'hoy' };
      const param2 = { hey2: 'hoy2' };
      await di.emit('onHoyEvent', param1, param2);
      const hey = await di.get('Hey');
      expect(hey.hoy).to.be.deep.equal([param1, param2]);
    });

    it('should throw if listener is not a function', async function() {
      const injectionDict = {
        'Hey': {
          constructible: Hey,
          deps: { hey: 'hey' },
          onHoyEvent: 'hey'
        },
      }
      const di = new DiContainer({ logger, load: injectionDict });
      const param1 = { hey: 'hoy' };
      const param2 = { hey2: 'hoy2' };
      expect(di.emit('onHoyEvent', param1, param2)).to.eventually.throw();
    });
  });

});