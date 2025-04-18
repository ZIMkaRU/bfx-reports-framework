'use strict'

const { promisify } = require('util')
const setImmediatePromise = promisify(setImmediate)

const {
  orderBy
} = require('lodash')
const { merge } = require('lib-js-util-base')

const SyncTempTablesManager = require('../sync.temp.tables.manager')
const DataInserterHook = require('./data.inserter.hook')
const { getAuthFromDb } = require('../helpers/utils')
const {
  SubAccountLedgersBalancesRecalcError
} = require('../../../errors')

const { decorateInjectable } = require('../../../di/utils')

const depsTypes = (TYPES) => [
  TYPES.DAO,
  TYPES.TABLES_NAMES,
  TYPES.Authenticator
]
class RecalcSubAccountLedgersBalancesHook extends DataInserterHook {
  constructor (
    dao,
    TABLES_NAMES,
    authenticator
  ) {
    super()

    this.dao = dao
    this.TABLES_NAMES = TABLES_NAMES
    this.authenticator = authenticator
  }

  _getSubUsersIdsByMasterUserId (auth, userId) {
    if (!Number.isInteger(userId)) {
      return null
    }

    return [...auth]
      .reduce((accum, [key, payload]) => {
        const {
          _id: masterUserId,
          isSubAccount,
          subUser
        } = payload ?? {}
        const { _id } = subUser ?? {}

        if (
          isSubAccount &&
          masterUserId === userId &&
          Number.isInteger(_id)
        ) {
          accum.push(_id)
        }

        return accum
      }, [])
  }

  _getRecalcBalance (auth, elems, item) {
    const {
      id,
      mts,
      wallet,
      currency,
      user_id: userId,
      _nativeBalance,
      _nativeBalanceUsd
    } = item ?? {}
    const subUsersIds = this._getSubUsersIdsByMasterUserId(
      auth,
      userId
    )

    if (
      !Array.isArray(subUsersIds) ||
      subUsersIds.length === 0
    ) {
      return {
        balance: _nativeBalance,
        balanceUsd: _nativeBalanceUsd,
        _isBalanceRecalced: null
      }
    }

    const _elems = elems
      .filter(({
        id: _id,
        mts: _mts,
        wallet: _wallet,
        currency: _currency,
        user_id: _userId,
        subUserId: _subUserId
      }) => (
        Number.isInteger(_subUserId) &&
        _userId === userId &&
        _id <= id &&
        _mts <= mts &&
        _wallet === wallet &&
        _currency === currency
      ))
    const subUsersBalances = []
    const subUsersBalancesUsd = []

    for (const subUserId of subUsersIds) {
      const _item = _elems
        .find(({ subUserId: sId }) => subUserId === sId)
      const {
        _nativeBalance: balance,
        _nativeBalanceUsd: balanceUsd
      } = _item ?? {}

      if (Number.isFinite(balance)) {
        subUsersBalances.push(balance)
      }
      if (Number.isFinite(balanceUsd)) {
        subUsersBalancesUsd.push(balanceUsd)
      }
    }

    const _balance = subUsersBalances
      .reduce((accum, balance) => {
        return Number.isFinite(balance)
          ? accum + balance
          : accum
      }, 0)
    const _balanceUsd = subUsersBalancesUsd
      .reduce((accum, balance) => {
        return Number.isFinite(balance)
          ? accum + balance
          : accum
      }, 0)

    const balance = subUsersBalances.length === 0
      ? _nativeBalance
      : _balance
    const balanceUsd = subUsersBalancesUsd.length === 0
      ? _nativeBalanceUsd
      : _balanceUsd

    return {
      balance,
      balanceUsd,
      _isBalanceRecalced: 1
    }
  }

  _getRecalcBalanceAsync (
    auth,
    recordsToGetBalances,
    elem
  ) {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const res = this._getRecalcBalance(
            auth,
            recordsToGetBalances,
            elem
          )

          resolve(res)
        } catch (err) {
          reject(err)
        }
      })
    })
  }

  _getFirstGroupedRecords (elems = []) {
    return elems.reduce((accum, curr) => {
      const {
        wallet,
        currency,
        user_id: userId,
        subUserId
      } = curr ?? {}
      const hasNotGroup = accum.every(({
        wallet: _wallet,
        currency: _currency,
        user_id: _userId,
        subUserId: _subUserId
      }) => (
        wallet !== _wallet ||
        currency !== _currency ||
        userId !== _userId ||
        subUserId !== _subUserId
      ))

      if (hasNotGroup) {
        accum.push({ ...curr })
      }

      return accum
    }, [])
  }

  async _getInitialElems (
    auth,
    firstGroupedRecords = [],
    tempTableName
  ) {
    const order = [['mts', -1], ['id', -1]]
    const res = []

    for (const elem of firstGroupedRecords) {
      const {
        mts,
        wallet,
        currency,
        user_id: id,
        subUserId: _subUserId
      } = elem ?? {}
      const subUsersIds = this._getSubUsersIdsByMasterUserId(auth, id)

      if (
        !Array.isArray(subUsersIds) ||
        subUsersIds.length === 0
      ) {
        continue
      }

      const emptyRes = {
        mts,
        wallet,
        currency,
        user_id: id,
        _nativeBalance: null,
        _nativeBalanceUsd: null
      }
      const mainFilter = {
        $eq: {
          wallet,
          currency,
          user_id: id
        },
        $lte: { mts }
      }

      for (const subUserId of subUsersIds) {
        if (subUserId === _subUserId) {
          continue
        }

        const filter = merge(
          { $eq: { subUserId } },
          mainFilter
        )

        const itemFromMainTable = await this.dao.getElemInCollBy(
          this.TABLES_NAMES.LEDGERS,
          filter,
          order,
          { withWorkerThreads: false }
        )
        const itemFromTempTable = Number.isInteger(this._opts.syncQueueId)
          ? await this.dao.getElemInCollBy(
            tempTableName,
            filter,
            order,
            { withWorkerThreads: false }
          )
          : null
        const itemsFromDb = [itemFromMainTable, itemFromTempTable]
          .filter((item) => (
            Number.isFinite(item?.mts) &&
            Number.isFinite(item?.id)
          ))
        const itemFromDb = orderBy(
          itemsFromDb,
          ['mts', 'id'],
          ['desc', 'desc']
        )[0]

        res.push({
          ...emptyRes,
          ...itemFromDb,
          subUserId
        })
      }
    }

    return res
  }

  /**
   * @override
   */
  async execute () {
    const dataInserter = this.getDataInserter()
    const auth = dataInserter
      ? dataInserter.getAuth()
      : (await getAuthFromDb(
          this.authenticator,
          { shouldGetEveryone: true }
        )).syncAuth

    if (
      !auth ||
      !(auth instanceof Map) ||
      auth.size === 0
    ) {
      if (!dataInserter) {
        return
      }

      throw new SubAccountLedgersBalancesRecalcError()
    }

    const tableName = this._getTableName()

    if (
      this._shouldTempTableBeUsed() &&
      !(await this.dao.hasTable(tableName))
    ) {
      return
    }

    const authIds = [...auth]
      .map(([key, auth]) => auth?._id)
      .filter((id) => Number.isFinite(id))
    const requiredUserIds = [...new Set(authIds)]

    const firstNotRecalcedElem = await this.dao.getElemInCollBy(
      tableName,
      {
        $isNotNull: 'subUserId',
        $isNull: '_isBalanceRecalced',
        $in: { user_id: requiredUserIds }
      },
      [['mts', 1], ['id', 1]],
      { withWorkerThreads: false }
    )

    let { mts } = firstNotRecalcedElem ?? {}
    let count = 0
    let skipedIds = []

    if (!mts) {
      return
    }

    while (true) {
      await setImmediatePromise()

      count += 1

      if (count > 1000) break

      const elems = await this.dao.getElemsInCollBy(
        tableName,
        {
          filter: {
            $gte: { mts },
            $nin: { _id: skipedIds },
            $in: { user_id: requiredUserIds },
            $isNotNull: 'subUserId'
          },
          sort: [['mts', 1], ['id', 1]],
          limit: 20000,
          withWorkerThreads: false
        }
      )

      if (
        !Array.isArray(elems) ||
        elems.length === 0
      ) {
        break
      }

      const firstGroupedRecords = this._getFirstGroupedRecords(elems)
      const initialElems = await this._getInitialElems(
        auth,
        firstGroupedRecords,
        tableName
      )
      const recordsToGetBalances = orderBy(
        [...initialElems, ...elems],
        ['mts', 'id'],
        ['desc', 'desc']
      )
      const recalcElems = []

      for (const elem of elems) {
        const _elem = elem ?? {}
        const {
          balance,
          balanceUsd,
          _isBalanceRecalced
        } = await this._getRecalcBalanceAsync(
          auth,
          recordsToGetBalances,
          _elem
        )

        recalcElems.push(Object.assign(_elem, {
          balance,
          balanceUsd,
          _isBalanceRecalced
        }))
      }

      await this.dao.updateElemsInCollBy(
        tableName,
        recalcElems,
        ['_id'],
        ['balance', 'balanceUsd', '_isBalanceRecalced']
      )
      await this.dao.optimize()

      const lastElem = elems[elems.length - 1]

      mts = lastElem.mts
      skipedIds = elems
        .filter(({ mts: _mts }) => mts === _mts)
        .map(({ _id }) => _id)
    }
  }

  _getTableName () {
    const tableName = this._shouldTempTableBeUsed()
      ? SyncTempTablesManager.getTempTableName(
        this.TABLES_NAMES.LEDGERS,
        this._opts.syncQueueId
      )
      : this.TABLES_NAMES.LEDGERS

    return tableName
  }

  _shouldTempTableBeUsed () {
    return Number.isInteger(this._opts.syncQueueId)
  }
}

decorateInjectable(RecalcSubAccountLedgersBalancesHook, depsTypes)

module.exports = RecalcSubAccountLedgersBalancesHook
