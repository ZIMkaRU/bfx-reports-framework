'use strict'

const _getConstraintsQuery = (name, model) => {
  const modelConstraints = model.getConstraints()
  const constraintsArr = Array.isArray(modelConstraints)
    ? modelConstraints
    : [modelConstraints]

  return constraintsArr.reduce((accum, item) => {
    const _constraints = (
      item &&
      typeof item === 'string'
    )
      ? `, \n  ${item}`
      : ''
    const constraints = _constraints
      .replace(/#{tableName\}/g, name)

    return `${accum}${constraints}`
  }, '')
}

module.exports = (models = [], opts = {}) => {
  const {
    shouldNotAddIfNotExistsStm,
    namePrefix
  } = opts ?? {}

  const _models = models instanceof Map
    ? [...models]
    : models
  const _modelsArr = Array.isArray(_models)
    ? _models
    : [_models]

  return _modelsArr.map(([name, model]) => {
    const prefix = typeof namePrefix === 'function'
      ? namePrefix(name, model)
      : namePrefix ?? ''
    const _name = `${prefix}${name}`
    const constraints = _getConstraintsQuery(_name, model)

    const keys = model.getModelFieldKeys()
    const columnDefs = keys.reduce((accum, field, i, arr) => {
      const isLast = arr.length === (i + 1)
      const type = model[field]

      return `${accum}${field} ${type}${isLast ? '' : ', \n  '}`
    }, '')
    const condition = shouldNotAddIfNotExistsStm
      ? ''
      : ' IF NOT EXISTS'

    return `CREATE TABLE${condition} ${_name}\n(\n  ${columnDefs}${constraints}\n)`
  })
}
