'use strict';

const loaders = require('./loaders');
const Promise = require('bluebird');
const lodash = require('lodash');

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
    return await item.toJSON({ shallow: true, ...options });
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

// @see https://github.com/graphql/graphql-js/blob/872c6b98a2fd21946aec25e757236c6652f16229/src/language/ast.ts
const extractSelectionFields = (Model, fieldNodes = []) => {
  let columns = [];
  // By default, return everything
  if (!fieldNodes || fieldNodes.length === 0) return '*';
  for (let i = 0; i < fieldNodes.length; i++) {
    const node = fieldNodes[i];
    if (node.kind !== 'Field') {
      continue;
    }
    const selections =
      (node.selectionSet && node.selectionSet.selections) || [];
    // Extract the requested columns from the query
    let columnsToSelect = selections.map(selectionNode => {
      if (!selectionNode.kind === 'Field') return null;
      return selectionNode.name && selectionNode.name.value;
    });
    // Filter out nulls
    columnsToSelect = columnsToSelect.filter(c => !!c);
    if (columnsToSelect.length === 0) {
      continue;
    }
    for (let j = 0; j < columnsToSelect.length; j++) {
      const column = columnsToSelect[j];
      const isAssociation = typeof Model.prototype[column] === 'function';
      const isVirtual =
        Model.prototype.virtuals &&
        Object.keys(Model.prototype.virtuals).indexOf(column) > -1;
      if (!isAssociation && !isVirtual) {
        columns.push(`${Model.prototype.tableName}.${column}`);
      }
    }
  }
  columns = lodash.uniq(columns);
  if (columns.length > 0) {
    // Id column will be needed subsequently by other resolvers
    if (columns.indexOf('id') === -1 && Model.prototype.idAttribute !== null) {
      columns.push('id');
    }
    return columns;
  }
  return '*';
};

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
    return async function resolver(
      modelInstance,
      args,
      context = {},
      info,
      extra
    ) {
      console.log(`info`, require('util').inspect(info, { depth: null }));
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
            throw new Error(
              'Parameter [extra] should be either a function or an object'
            );
        }
      }
      const columns = extractSelectionFields(Model, info.fieldNodes);
      if (isAssociation) {
        context.loaders && context.loaders(model, { accessor, options });
        const associationResult = await model.fetch({ ...options, columns });
        const jsonResult = await exposeAttributes(associationResult, options);
        console.log(`result`, jsonResult);
      }
      const fn =
        info.returnType.constructor.name === 'GraphQLList'
          ? 'fetchAll'
          : 'fetch';
      return model[fn]({ ...options, columns })
        .then(c => {
          return exposeAttributes(c, options);
        })
        .then(result => {
          console.log(`result`, result);
          return result;
        });
    };
  },
};
