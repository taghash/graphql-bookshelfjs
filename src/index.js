'use strict';

const loaders = require('./loaders');
const Promise = require('bluebird');

/**
 * Quick workaround allowing GraphQL to access model attributes directly
 * (to access a bookshelf model attribute (like model.name), we have to use the .get() method)
 *
 * @param {object} collection
 * @returns {*}
 */
async function exposeAttributes(collection, options) {
  async function exposeModelAttributes(item) {
    // Make sure that relations are excluded
    return Object.assign(
      item,
      await item.toJSON({ shallow: true, ...options })
    );
  }
  if (collection) {
    if (collection.hasOwnProperty('length')) {
      return Promise.map(
        collection.map(m => {
          return m;
        }),
        exposeModelAttributes
      );
    }
    return exposeModelAttributes(collection);
  }
  return collection;
}

module.exports = {
  /**
   *
   * @returns {function}
   */
  getLoaders() {
    return loaders;
  },

  /**
   *
   * @param {function} Model
   * @returns {function}
   */
  resolverFactory(Model) {
    return function resolver(modelInstance, args, context = {}, info, extra) {
      console.log(`info`, info);
      const { accessor, options } = context;
      const isAssociation =
        typeof Model.prototype[info.fieldName] === 'function';
      const model = isAssociation
        ? modelInstance.related(info.fieldName)
        : new Model({}, { accessor });
      for (const key in args) {
        model.where(`${model.tableName}.${key}`, args[key]);
      }
      if (extra) {
        switch (typeof extra) {
          case 'function':
            extra(model);
            break;

          case 'object':
            for (const key in extra) {
              model[key](...extra[key]);
              delete extra[key];
            }
            break;

          default:
            return Promise.reject(
              'Parameter [extra] should be either a function or an object'
            );
        }
      }
      if (isAssociation) {
        context.loaders && context.loaders(model, { accessor, options });
        return model.fetch(options).then(c => {
          return exposeAttributes(c, options);
        });
      }
      const fn =
        info.returnType.constructor.name === 'GraphQLList'
          ? 'fetchAll'
          : 'fetch';
      return model[fn](options).then(c => {
        return exposeAttributes(c, options);
      });
    };
  },
};
