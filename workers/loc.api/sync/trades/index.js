'use strict'

const {
  splitSymbolPairs
} = require('bfx-report/workers/loc.api/helpers')

const {
  calcGroupedData,
  groupByTimeframe,
  getMtsGroupedByTimeframe
} = require('../helpers')

const { decorateInjectable } = require('../../di/utils')

const depsTypes = (TYPES) => [
  TYPES.DAO,
  TYPES.ALLOWED_COLLS,
  TYPES.SyncSchema,
  TYPES.FOREX_SYMBS,
  TYPES.CurrencyConverter,
  TYPES.Authenticator,
  TYPES.SYNC_API_METHODS
]
class Trades {
  constructor (
    dao,
    ALLOWED_COLLS,
    syncSchema,
    FOREX_SYMBS,
    currencyConverter,
    authenticator,
    SYNC_API_METHODS
  ) {
    this.dao = dao
    this.ALLOWED_COLLS = ALLOWED_COLLS
    this.syncSchema = syncSchema
    this.FOREX_SYMBS = FOREX_SYMBS
    this.currencyConverter = currencyConverter
    this.authenticator = authenticator
    this.SYNC_API_METHODS = SYNC_API_METHODS

    this.tradesMethodColl = this.syncSchema.getMethodCollMap()
      .get(this.SYNC_API_METHODS.TRADES)
    this.tradesModelFields = this.syncSchema
      .getModelOf(this.ALLOWED_COLLS.TRADES)
      .getModelFields()
  }

  async _getTrades ({
    auth,
    start,
    end,
    symbol
  }) {
    const user = await this.authenticator
      .verifyRequestUser({ auth })

    const symbFilter = (
      Array.isArray(symbol) &&
      symbol.length !== 0
    )
      ? { $in: { symbol } }
      : {}

    return this.dao.getElemsInCollBy(
      this.ALLOWED_COLLS.TRADES,
      {
        filter: {
          user_id: user._id,
          $lte: { mtsCreate: end },
          $gte: { mtsCreate: start },
          ...symbFilter
        },
        sort: [['mtsCreate', -1]],
        projection: this.tradesModelFields,
        exclude: ['user_id'],
        isExcludePrivate: true
      }
    )
  }

  _calcAmounts (data = []) {
    return data.map((trade) => {
      const _trade = trade ?? {}
      const {
        execAmount,
        execPrice,
        fee,
        feeCurrency,
        symbol
      } = _trade
      const [baseCurrency, symb] = splitSymbolPairs(symbol)
      const isFeeInUsd = feeCurrency === 'USD'
      const isPriceInUsd = symb === 'USD'

      const calcAmount = (
        Number.isFinite(execAmount) &&
        Number.isFinite(execPrice)
      )
        ? Math.abs(execAmount * execPrice)
        : null

      const _feeUsd = (
        isFeeInUsd &&
        Number.isFinite(fee)
      )
        ? fee
        : null
      const feeUsd = (
        !isFeeInUsd &&
        isPriceInUsd &&
        Number.isFinite(fee) &&
        Number.isFinite(execPrice)
      )
        ? fee * execPrice
        : _feeUsd
      const _feeForCurrConv = (
        !isFeeInUsd &&
        !isPriceInUsd &&
        Number.isFinite(fee)
      )
        ? fee
        : null
      const feeForCurrConv = (
        Number.isFinite(_feeForCurrConv) &&
        Number.isFinite(execPrice) &&
        symb !== feeCurrency
      )
        ? _feeForCurrConv * execPrice
        : _feeForCurrConv

      _trade.calcAmount = calcAmount
      _trade.feeUsd = feeUsd
      _trade.feeForCurrConv = feeForCurrConv
      _trade.baseCurrency = baseCurrency

      return _trade
    })
  }

  _calcTrades (fieldName) {
    return (data = []) => data.reduce((accum, trade = {}) => {
      const value = trade?.[fieldName]

      if (!Number.isFinite(value)) {
        return accum
      }

      accum.USD = Number.isFinite(accum?.USD)
        ? accum.USD + value
        : value

      return accum
    }, {})
  }

  _getTradesByTimeframe () {
    return ({ tradesGroupedByTimeframe = {} }) => {
      const tradesArr = Object.entries(tradesGroupedByTimeframe)

      if (tradesArr.length === 0) {
        return { USD: 0 }
      }

      const res = tradesArr.reduce((
        accum,
        [symb, amount]
      ) => {
        if (
          symb !== 'USD' ||
          !Number.isFinite(amount)
        ) {
          return accum
        }

        accum[symb] = amount

        return accum
      }, {})

      return res
    }
  }

  async getTrades (
    {
      auth = {},
      params = {}
    } = {}
  ) {
    const {
      start = 0,
      end = Date.now(),
      symbol: symbs
    } = params ?? {}
    const _symbol = Array.isArray(symbs)
      ? symbs
      : [symbs]
    const symbol = _symbol.filter((s) => (
      s && typeof s === 'string'
    ))
    const args = {
      auth,
      start,
      end,
      symbol
    }

    const tradesSymbolFieldName = this.tradesMethodColl
      .getModelField('SYMBOL_FIELD_NAME')
    const tradesDateFieldName = this.tradesMethodColl
      .getModelField('DATE_FIELD_NAME')

    const trades = await this._getTrades(args)
    const calcedTradesAmount = this._calcAmounts(
      trades
    )
    const convertedTrades = await this.currencyConverter
      .convertManyByCandles(
        calcedTradesAmount,
        {
          symbolFieldName: tradesSymbolFieldName,
          dateFieldName: tradesDateFieldName,
          convFields: [
            {
              inputField: 'calcAmount',
              outputField: 'amountUsd'
            },
            {
              inputField: 'feeForCurrConv',
              outputField: 'feeUsd'
            }
          ]
        }
      )

    return convertedTrades
  }

  async _getStartingMts (
    args,
    groupedTrades
  ) {
    if (
      Array.isArray(groupedTrades) &&
      groupedTrades.length > 0 &&
      Number.isInteger(groupedTrades[groupedTrades.length - 1]?.mts)
    ) {
      return groupedTrades[groupedTrades.length - 1].mts
    }

    const { params } = args ?? {}
    const { start = 0 } = params ?? {}

    return start
  }

  async getGroupedDataIn (
    fieldName,
    {
      auth = {},
      params = {}
    } = {}
  ) {
    const {
      start = 0,
      end = Date.now(),
      timeframe = 'day'
    } = params ?? {}
    const tradesSymbolFieldName = this.tradesMethodColl
      .getModelField('SYMBOL_FIELD_NAME')
    const args = {
      auth,
      params: {
        ...params,
        start,
        end,
        timeframe
      }
    }

    const trades = await this.getTrades(args)

    const tradesGroupedByTimeframe = await groupByTimeframe(
      trades,
      { timeframe, start, end },
      this.FOREX_SYMBS,
      'mtsCreate',
      tradesSymbolFieldName,
      this._calcTrades(fieldName)
    )
    const startingMts = await this._getStartingMts(
      args,
      tradesGroupedByTimeframe
    )
    const mtsGroupedByTimeframe = getMtsGroupedByTimeframe(
      startingMts,
      end,
      timeframe,
      true
    )

    const groupedData = await calcGroupedData(
      {
        tradesGroupedByTimeframe,
        mtsGroupedByTimeframe
      },
      false,
      this._getTradesByTimeframe(),
      true
    )

    return groupedData
  }
}

decorateInjectable(Trades, depsTypes)

module.exports = Trades
