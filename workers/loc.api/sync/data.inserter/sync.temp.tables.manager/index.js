'use strict'

const { decorateInjectable } = require('../../../di/utils')

const { SyncQueueIDSettingError } = require('../../../errors')

const BASE_NAME_PREFIX = 'temp_s'

const depsTypes = (TYPES) => [
  TYPES.DAO,
  TYPES.TABLES_NAMES,
  TYPES.SyncSchema,
  TYPES.SYNC_API_METHODS,
  TYPES.SYNC_QUEUE_STATES
]
class SyncTempTablesManager {
  constructor (
    dao,
    TABLES_NAMES,
    syncSchema,
    SYNC_API_METHODS,
    SYNC_QUEUE_STATES
  ) {
    this.dao = dao
    this.TABLES_NAMES = TABLES_NAMES
    this.syncSchema = syncSchema
    this.SYNC_API_METHODS = SYNC_API_METHODS
    this.SYNC_QUEUE_STATES = SYNC_QUEUE_STATES

    this.syncQueueId = null

    this._methodCollMap = this.syncSchema.getMethodCollMap()
  }

  init (params = {}) {
    if (!Number.isInteger(params?.syncQueueId)) {
      throw new SyncQueueIDSettingError()
    }

    this.syncQueueId = params.syncQueueId
  }

  async createTempDBStructureForCurrSync (methodCollMap) {
    const models = [...methodCollMap]
      .map(([method, schema]) => {
        const name = schema.getModelField('NAME')
        const model = schema.getModelField('MODEL')

        return [name, model]
      })
    const namePrefix = this.getCurrNamePrefix()

    await this.dao.createDBStructure({ models, namePrefix })
  }

  async removeTempDBStructureForCurrSync (opts) {
    const {
      isNotInTrans,
      doNotQueueQuery
    } = opts ?? {}

    await this.dao.dropAllTables({
      expectations: [this.getCurrNamePrefix()],
      isNotStrictEqual: true,
      isNotInTrans,
      doNotQueueQuery
    })
  }

  async moveTempTableDataToMain (opts) {
    const {
      isNotInTrans,
      doNotQueueQuery,
      isStrictEqual
    } = opts ?? {}

    await this.dao.moveTempTableDataToMain({
      namePrefix: this.getCurrNamePrefix(),
      isNotInTrans,
      doNotQueueQuery,
      isStrictEqual
    })
  }

  async cleanUpTempDBStructure () {
    /*
     * Don't remove temp DB tables of sync queue which can be processed
     * or/and sync can be continued in the future
     */
    const activeSyncs = await this.dao.getElemsInCollBy(
      this.TABLES_NAMES.SYNC_QUEUE,
      {
        sort: [['_id', 1]],
        filter: {
          state: [
            this.SYNC_QUEUE_STATES.NEW_JOB_STATE,
            this.SYNC_QUEUE_STATES.LOCKED_JOB_STATE,
            this.SYNC_QUEUE_STATES.ERROR_JOB_STATE
          ]
        }
      }
    )
    const exceptions = activeSyncs
      .map(({ _id }) => this.getCurrNamePrefix(_id))

    await this.dao.dropAllTables({
      expectations: [BASE_NAME_PREFIX],
      exceptions,
      isNotStrictEqual: true
    })
  }

  static async cleanUpAllTempDBStructure (deps) {
    const { dao } = deps ?? {}

    await dao.executeQueriesInTrans(async () => {
      await dao.dropAllTables({
        expectations: [BASE_NAME_PREFIX],
        isNotStrictEqual: true,
        isNotInTrans: true,
        doNotQueueQuery: true
      })
    })
  }

  getCurrNamePrefix (id) {
    const syncQueueId = id ?? this.syncQueueId

    return this.constructor.getNamePrefix(syncQueueId)
  }

  static getTempTableName (tableName, id) {
    const prefix = this.getNamePrefix(id)

    return `${prefix}${tableName}`
  }

  static getNamePrefix (id) {
    return `${BASE_NAME_PREFIX}${id}_`
  }

  static async getTempTableNamesByPattern (pattern, deps, opts) {
    const { dao } = deps ?? {}
    const { doNotQueueQuery } = opts ?? {}

    const tempTableNamePattern = this.getTempTableName(
      pattern,
      '\\d+'
    )
    const regExp = new RegExp(tempTableNamePattern)

    const tableNames = await dao.getTablesNames({ doNotQueueQuery })
    const tempTableNames = tableNames.filter((name) => (
      regExp.test(name)
    ))

    return tempTableNames
  }
}

decorateInjectable(SyncTempTablesManager, depsTypes)

module.exports = SyncTempTablesManager
