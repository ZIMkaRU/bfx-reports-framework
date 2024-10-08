'use strict'

const _getTriggersQuery = (
  name,
  model,
  opts
) => {
  const {
    shouldNotAddIfNotExistsStm
  } = opts ?? {}

  const modelTriggers = model.getTriggers()
  const triggersArr = Array.isArray(modelTriggers)
    ? modelTriggers
    : [modelTriggers]

  return triggersArr.reduce((accum, item) => {
    if (
      !item ||
      typeof item !== 'string'
    ) {
      return accum
    }

    const stm = item.replace(/#{tableName\}/g, name)
    const condition = shouldNotAddIfNotExistsStm
      ? ''
      : ' IF NOT EXISTS'
    const trigger = `CREATE TRIGGER${condition} ${stm}`

    accum.push(trigger)

    return accum
  }, [])
}

module.exports = (models = [], opts = {}) => {
  const {
    namePrefix
  } = opts ?? {}

  const _models = models instanceof Map
    ? [...models]
    : models
  const _modelsArr = Array.isArray(_models)
    ? _models
    : [_models]

  return _modelsArr.reduce((accum, [name, model]) => {
    const prefix = typeof namePrefix === 'function'
      ? namePrefix(name, model)
      : namePrefix ?? ''
    const _name = `${prefix}${name}`
    const triggers = _getTriggersQuery(
      _name,
      model,
      opts
    )

    accum.push(...triggers)

    return accum
  }, [])
}
