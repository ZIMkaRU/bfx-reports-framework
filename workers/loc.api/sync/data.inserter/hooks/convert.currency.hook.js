'use strict'

const { promisify } = require('util')
const setImmediatePromise = promisify(setImmediate)

const SyncTempTablesManager = require('../sync.temp.tables.manager')
const { CONVERT_TO } = require('../const')
const DataInserterHook = require('./data.inserter.hook')

const { decorateInjectable } = require('../../../di/utils')

const depsTypes = (TYPES) => [
  TYPES.DAO,
  TYPES.CurrencyConverter,
  TYPES.ALLOWED_COLLS
]
class ConvertCurrencyHook extends DataInserterHook {
  constructor (
    dao,
    currencyConverter,
    ALLOWED_COLLS
  ) {
    super()

    this.dao = dao
    this.currencyConverter = currencyConverter
    this.ALLOWED_COLLS = ALLOWED_COLLS
  }

  _getConvSchema () {
    return new Map([
      [
        this.ALLOWED_COLLS.LEDGERS,
        {
          symbolFieldName: 'currency',
          dateFieldName: 'mts',
          convFields: [
            { inputField: 'amount', outputField: 'amountUsd' },
            {
              inputField: '_nativeBalance',
              outputField: ['balanceUsd', '_nativeBalanceUsd']
            }
          ]
        }
      ],
      [
        this.ALLOWED_COLLS.MOVEMENTS,
        {
          symbolFieldName: 'currency',
          dateFieldName: 'mtsUpdated',
          convFields: [
            { inputField: 'amount', outputField: 'amountUsd' }
          ]
        }
      ]
    ])
  }

  /**
   * @override
   */
  async execute (names = []) {
    const _names = Array.isArray(names)
      ? names
      : [names]
    const { syncColls } = this._opts

    if (syncColls.every(name => (
      name !== this.ALLOWED_COLLS.ALL &&
      name !== this.ALLOWED_COLLS.CANDLES &&
      name !== this.ALLOWED_COLLS.LEDGERS
    ))) {
      return
    }

    const convSchema = this._getConvSchema()

    for (const [collName, schema] of convSchema) {
      if (_names.length > 0) {
        const isSkipped = _names.every((name) => (
          !name ||
          name !== collName
        ))

        if (isSkipped) continue
      }

      let count = 0
      let _id = 0

      const _schema = {
        shouldTempTablesBeIncluded: true,
        convertTo: CONVERT_TO,
        ...schema
      }
      const { convFields } = schema ?? {}
      const updatedFieldNames = convFields
        .reduce((accum, { outputField }) => {
          const _outputField = Array.isArray(outputField)
            ? outputField
            : [outputField]

          accum.push(..._outputField)

          return accum
        }, [])
      const tableName = this._getTableName(collName)

      if (
        this._shouldTempTableBeUsed() &&
        !(await this.dao.hasTable(tableName))
      ) {
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
              $gt: { _id },
              $isNull: updatedFieldNames
            },
            sort: [['_id', 1]],
            limit: 10000,
            withWorkerThreads: false
          }
        )

        if (!Array.isArray(elems) || elems.length === 0) {
          break
        }

        const convElems = await this.currencyConverter
          .convertByCandles(
            elems,
            _schema,
            { withWorkerThreads: false }
          )

        if (collName === this.ALLOWED_COLLS.LEDGERS) {
          await this.dao.updateElemsInCollBy(
            tableName,
            convElems.map((item) => ({
              ...item,
              _isBalanceRecalced: null
            })),
            ['_id'],
            [...updatedFieldNames, '_isBalanceRecalced']
          )
          await this.dao.optimize()

          _id = elems[elems.length - 1]._id

          continue
        }

        await this.dao.updateElemsInCollBy(
          tableName,
          convElems,
          ['_id'],
          updatedFieldNames
        )
        await this.dao.optimize()

        _id = elems[elems.length - 1]._id
      }
    }
  }

  _getTableName (collName) {
    const tableName = this._shouldTempTableBeUsed()
      ? SyncTempTablesManager.getTempTableName(
        collName,
        this._opts.syncQueueId
      )
      : collName

    return tableName
  }

  _shouldTempTableBeUsed () {
    return Number.isInteger(this._opts.syncQueueId)
  }
}

decorateInjectable(ConvertCurrencyHook, depsTypes)

module.exports = ConvertCurrencyHook
