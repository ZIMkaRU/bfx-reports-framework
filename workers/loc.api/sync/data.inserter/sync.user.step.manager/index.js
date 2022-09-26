'use strict'

const {
  isEmpty,
  min,
  max
} = require('lodash')

const {
  isInsertableArrObjTypeOfColl
} = require('../../schema/utils')
const {
  invertSort
} = require('../data.checker/helpers')
const SyncTempTablesManager = require('../sync.temp.tables.manager')

const { decorateInjectable } = require('../../../di/utils')

const {
  SyncQueueIDSettingError,
  LastSyncedInfoGettingError
} = require('../../../errors')

const depsTypes = (TYPES) => [
  TYPES.DAO,
  TYPES.TABLES_NAMES,
  TYPES.SyncSchema,
  TYPES.SYNC_API_METHODS,
  TYPES.SyncUserStepDataFactory
]
class SyncUserStepManager {
  constructor (
    dao,
    TABLES_NAMES,
    syncSchema,
    SYNC_API_METHODS,
    syncUserStepDataFactory
  ) {
    this.dao = dao
    this.TABLES_NAMES = TABLES_NAMES
    this.syncSchema = syncSchema
    this.SYNC_API_METHODS = SYNC_API_METHODS
    this.syncUserStepDataFactory = syncUserStepDataFactory

    this.syncQueueId = null

    this._methodCollMap = this.syncSchema.getMethodCollMap()
  }

  init (params = {}) {
    if (!Number.isInteger(params?.syncQueueId)) {
      throw new SyncQueueIDSettingError()
    }

    this.syncQueueId = params.syncQueueId
  }

  async getLastSyncedInfoForCurrColl (syncSchema, params) {
    if (!isInsertableArrObjTypeOfColl(syncSchema)) {
      throw new LastSyncedInfoGettingError()
    }

    const {
      collName,
      userId,
      subUserId
    } = params ?? {}

    const hasSubUserIdField = (
      typeof syncSchema?.model?.subUserId === 'string' &&
      Number.isInteger(subUserId)
    )
    const {
      name: tableName,
      dateFieldName,
      sort: tableOrder
    } = syncSchema
    const tempTableName = this._getCurrNamePrefix()
    const hasTempTable = await this.dao.hasTable(tempTableName)

    const userIdFilter = hasSubUserIdField
      ? { $eq: { user_id: userId, subUserId } }
      : { $eq: { user_id: userId } }

    const syncUserStepInfoPromise = this.dao.getElemInCollBy(
      this.TABLES_NAMES.SYNC_USER_STEPS,
      {
        collName,
        ...userIdFilter
      },
      [['syncedAt', -1]]
    )
    const lastElemFromMainTablePromise = this.dao.getElemInCollBy(
      tableName,
      userIdFilter,
      tableOrder
    )
    const firstElemFromMainTablePromise = this.dao.getElemInCollBy(
      tableName,
      userIdFilter,
      invertSort(tableOrder)
    )
    const lastElemFromTempTablePromise = hasTempTable
      ? this.dao.getElemInCollBy(
          tempTableName,
          userIdFilter,
          tableOrder
        )
      : null
    const firstElemFromTempTablePromise = hasTempTable
      ? this.dao.getElemInCollBy(
          tempTableName,
          userIdFilter,
          invertSort(tableOrder)
        )
      : null

    const [
      syncUserStepInfo,
      lastElemFromMainTable,
      firstElemFromMainTable,
      lastElemFromTempTable,
      firstElemFromTempTable
    ] = Promise.all([
      syncUserStepInfoPromise,
      lastElemFromMainTablePromise,
      firstElemFromMainTablePromise,
      lastElemFromTempTablePromise,
      firstElemFromTempTablePromise
    ])

    const {
      baseStart,
      baseEnd,
      currStart,
      currEnd,
      isBaseStepReady = false,
      isCurrStepReady = false
    } = syncUserStepInfo ?? {}

    const isMainTableEmpty = isEmpty(lastElemFromMainTable)
    const isTempTableEmpty = isEmpty(lastElemFromTempTable)
    const firstElemMtsFromMainTable = firstElemFromMainTable?.[dateFieldName] ?? null
    const lastElemMtsFromMainTable = lastElemFromMainTable?.[dateFieldName] ?? null
    const firstElemMtsFromTempTable = firstElemFromTempTable?.[dateFieldName] ?? null
    const lastElemMtsFromTempTable = lastElemFromTempTable?.[dateFieldName] ?? null
    const lastElemMtsFromTables = max([lastElemMtsFromTempTable, lastElemMtsFromMainTable]) ?? 0

    if (
      !isBaseStepReady &&
      isMainTableEmpty &&
      isTempTableEmpty
    ) {
      const syncUserStepData = this.syncUserStepDataFactory({
        baseStart: baseStart ?? 0,
        baseEnd: baseEnd ?? Date.now(),
        isBaseStepReady
      })

      return {
        syncUserStepData,
        lastElemMtsFromTables
      }
    }

    const syncUserStepData = this.syncUserStepDataFactory({
      baseStart,
      baseEnd,
      currStart,
      currEnd,
      isBaseStepReady,
      isCurrStepReady
    })

    if (!isCurrStepReady) {
      syncUserStepData.setParams({
        currStart: min([currStart, lastElemMtsFromMainTable]) ?? 0,
        currEnd: min([currEnd, firstElemMtsFromTempTable]) ?? lastElemMtsFromMainTable ?? Date.now()
      })
    }
    if (!isBaseStepReady) {
      syncUserStepData.setParams({
        baseStart: min([baseStart, firstElemMtsFromMainTable]) ?? 0,
        baseEnd: min([baseEnd, firstElemMtsFromTempTable]) ?? lastElemMtsFromMainTable ?? Date.now()
      })
    }

    return {
      syncUserStepData,
      lastElemMtsFromTables
    }
  }

  _getCurrNamePrefix (id) {
    const syncQueueId = id ?? this.syncQueueId

    return SyncTempTablesManager._getNamePrefix(syncQueueId)
  }
}

decorateInjectable(SyncUserStepManager, depsTypes)

module.exports = SyncUserStepManager
