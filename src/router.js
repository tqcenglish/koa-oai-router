import assert from 'assert';
import Debug from 'debug';

import Router from './router-super';
import spec from './spec';
import swagger from './swagger';
import * as util from './util';
import {
  oai2koaUrlJoin,
  urlJoin,
} from './util/route';

import PluginRegister from './plugin-register';

const debug = new Debug('koa-oai-router');

class OAIRouter extends Router {
  constructor(opts = {}) {
    super(opts);

    const {
      apiDoc,
      apiExplorerVisible = true,
      apiCooker = (api) => {
        return api;
      },
      options = {},
      // 添加日志函数
      logger = console,
    } = opts;
    assert(util.isFunction(apiCooker), 'apiCooker must be function.');

    this.logger = logger;
    this.apiDoc = apiDoc;
    this.apiExplorerVisible = apiExplorerVisible;
    this.apiCooker = apiCooker;
    this.options = options;

    this.api = [];
    this.pluginRegister = new PluginRegister(this.options);
  }

  /**
   * Start to parse apiDoc and mount routes. Must called after all mount action is finished.
   * @public
   * @returns route dispatcher, koa middleware
   */
  routes() {
    if (!this.apiDoc) {
      return super.routes();
    }
    spec(this.apiDoc, this.logger)
      .then(async (api) => {
        if (Array.isArray(api)) {
          // 多个目录合并一个 api
          // this.api = await this.apiCooker(api.reduce((accumulator, currentValue) => {
          //   Object.assign(accumulator.paths, currentValue.paths);
          //   return accumulator;
          // }, api[0]));

          // 多个目录保持多个 api
          this.api = await Promise.all(api.map((item) => {
            return this.apiCooker(item);
          }));
        } else {
          this.api.push(await this.apiCooker(api));
        }


        await this.registerRoutes();
        await this.registerApiExplorer();

        debug('router is ready...');
        this.emit('ready');
      })
      .catch((error) => {
        console.error('router boot error: ', error);

        this.emit('error', error);
      });

    return super.routes();
  }

  /**
   * Register a handler of the field in OpenApi operation object.
   * @public true
   * @param {Plugin} plugin plugin object
   */
  async mount(pluginClass, args) {
    await this.pluginRegister.register(pluginClass, args);
  }

  /**
   * Initiate routes
   */
  async registerRoutes() {
    const paths = util.get(this, 'api.paths', {});

    await util.eachPromise(paths, async (path, pathValue) => {
      const endpoint = oai2koaUrlJoin(this.api[0].basePath, path);

      await util.eachPromise(pathValue, async (operation, operationValue) => {
        await this.registerRoute(endpoint, operation, operationValue);
      });
    });
  }

  /**
   * Initiate a single route to koa.
   */
  async registerRoute(endpoint, operation, operationValue) {
    const middlewareOpts = {
      endpoint,
      operation,
      operationValue,
      options: this.options,
    };

    const middlewares = await this.pluginRegister.load(middlewareOpts);

    debug('middlewares', middlewares);
    debug(`mount ${operation.toUpperCase()} ${endpoint} ${util.map(middlewares, 'name').join(' > ')}`);
    this[operation](endpoint, ...middlewares);
  }

  /**
   * OpenApi doc explorer
   * @public false
   */
  registerApiExplorer() {
    if (this.apiExplorerVisible === false) return;
    debug(`apiExplorer: ${urlJoin(this.options.prefix, 'api-explorer')}`);

    this.get('/api-explorer', (ctx) => {
      ctx.type = 'text/html';
      ctx.response.body = swagger.index;
    });

    this.get('/swagger-ui.css', (ctx) => {
      ctx.type = 'text/css';
      ctx.response.body = swagger.uiCss;
    });

    this.get('/swagger-ui-bundle.js', (ctx) => {
      ctx.type = 'application/javascript';
      ctx.response.body = swagger.bundleJs;
    });

    this.get('/swagger-ui-standalone-preset.js', (ctx) => {
      ctx.type = 'application/javascript';
      ctx.response.body = swagger.presetJs;
    });

    this.api.forEach((item) => {
      this.get(`/${item.info.title}.json`, (ctx) => {
        ctx.response.body = item;
      });
    });


    this.get('/api-explorer-config.json', (ctx) => {
      const urls = [];
      this.api.forEach((item) => {
        urls.push({
          name: item.info.title,
          url: urlJoin(this.options.prefix, `${item.info.title}.json`),
        });
      });

      ctx.response.body = {
        urls,
        displayOperationId: true,
        displayRequestDuration: true,
        showExtensions: true,
        defaultModelsExpandDepth: 0,
      };
    });
  }
}
export default OAIRouter;
