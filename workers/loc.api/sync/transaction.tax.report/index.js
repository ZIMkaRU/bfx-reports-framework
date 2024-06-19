'use strict'

const { pushLargeArr } = require('../../helpers/utils')
const { getBackIterable } = require('../helpers')

const {
  TRX_TAX_STRATEGIES,
  remapTrades,
  remapMovements,
  lookUpTrades,
  getTrxMapByCcy,
  findPublicTrade
} = require('./helpers')

const { decorateInjectable } = require('../../di/utils')

const depsTypes = (TYPES) => [
  TYPES.DAO,
  TYPES.Authenticator,
  TYPES.SyncSchema,
  TYPES.ALLOWED_COLLS,
  TYPES.SYNC_API_METHODS,
  TYPES.Movements,
  TYPES.RService,
  TYPES.GetDataFromApi,
  TYPES.WSEventEmitterFactory,
  TYPES.Logger
]
class TransactionTaxReport {
  constructor (
    dao,
    authenticator,
    syncSchema,
    ALLOWED_COLLS,
    SYNC_API_METHODS,
    movements,
    rService,
    getDataFromApi,
    wsEventEmitterFactory,
    logger
  ) {
    this.dao = dao
    this.authenticator = authenticator
    this.syncSchema = syncSchema
    this.ALLOWED_COLLS = ALLOWED_COLLS
    this.SYNC_API_METHODS = SYNC_API_METHODS
    this.movements = movements
    this.rService = rService
    this.getDataFromApi = getDataFromApi
    this.wsEventEmitterFactory = wsEventEmitterFactory
    this.logger = logger

    this.tradesModel = this.syncSchema.getModelsMap()
      .get(this.ALLOWED_COLLS.TRADES)
  }

  async makeTrxTaxReportInBackground (args = {}) {
    const { auth, params } = args ?? {}
    const user = await this.authenticator
      .verifyRequestUser({ auth })
    const _args = { auth: user, params }

    this.wsEventEmitterFactory()
      .emitTrxTaxReportGenerationInBackgroundToOne(() => {
        return this.getTransactionTaxReport(_args)
      }, user)
      .then(() => {}, (err) => {
        this.logger.error(`TRX_TAX_REPORT_GEN_FAILED: ${err.stack || err}`)
      })

    return true
  }

  async getTransactionTaxReport (args = {}) {
    const { auth, params } = args ?? {}
    const start = params.start ?? 0
    const end = params.end ?? Date.now()
    const strategy = params.strategy ?? TRX_TAX_STRATEGIES.LIFO
    const user = await this.authenticator
      .verifyRequestUser({ auth })

    const isFIFO = strategy === TRX_TAX_STRATEGIES.FIFO
    const isLIFO = strategy === TRX_TAX_STRATEGIES.LIFO

    const {
      trxs: trxsForCurrPeriod,
      trxsForConvToUsd
    } = await this.#getTrxs({
      user,
      start,
      end
    })

    if (
      !Array.isArray(trxsForCurrPeriod) ||
      trxsForCurrPeriod.length === 0
    ) {
      return []
    }

    const {
      trxs: trxsForPrevPeriod
    } = start > 0
      ? await this.#getTrxs({
        user,
        start: 0,
        end: start - 1
      })
      : { trxs: [] }

    const isBackIterativeSaleLookUp = isFIFO && !isLIFO
    const isBackIterativeBuyLookUp = isFIFO && !isLIFO

    const { buyTradesWithUnrealizedProfit } = await lookUpTrades(
      trxsForPrevPeriod,
      {
        isBackIterativeSaleLookUp,
        isBackIterativeBuyLookUp,
        isBuyTradesWithUnrealizedProfitRequired: true,
        isNotGainOrLossRequired: true
      }
    )

    pushLargeArr(trxsForCurrPeriod, buyTradesWithUnrealizedProfit)
    pushLargeArr(
      trxsForConvToUsd,
      buyTradesWithUnrealizedProfit
        .filter((trx) => (
          !Number.isFinite(trx?.firstSymbPriceUsd) ||
          !Number.isFinite(trx?.lastSymbPriceUsd)
        ))
    )
    await this.#convertCurrencies(trxsForConvToUsd)

    const { saleTradesWithRealizedProfit } = await lookUpTrades(
      trxsForCurrPeriod,
      {
        isBackIterativeSaleLookUp,
        isBackIterativeBuyLookUp
      }
    )

    return saleTradesWithRealizedProfit
  }

  async #getTrxs (params) {
    const {
      user,
      start,
      end
    } = params ?? {}

    const tradesPromise = this.#getTrades(params)
    const withdrawalsPromise = this.movements.getMovements({
      auth: user,
      start,
      end,
      isWithdrawals: true,
      isExcludePrivate: false
    })
    const depositsPromise = this.movements.getMovements({
      auth: user,
      start,
      end,
      isDeposits: true,
      isExcludePrivate: false
    })

    const [
      trades,
      withdrawals,
      deposits
    ] = await Promise.all([
      tradesPromise,
      withdrawalsPromise,
      depositsPromise
    ])

    const movements = [...withdrawals, ...deposits]
    const remappedTrxs = []
    const remappedTrxsForConvToUsd = []

    remapTrades(
      trades,
      { remappedTrxs, remappedTrxsForConvToUsd }
    )
    remapMovements(
      movements,
      { remappedTrxs, remappedTrxsForConvToUsd }
    )

    const trxs = remappedTrxs
      .sort((a, b) => b?.mtsCreate - a?.mtsCreate)
    const trxsForConvToUsd = remappedTrxsForConvToUsd
      .sort((a, b) => b?.mtsCreate - a?.mtsCreate)

    return {
      trxs,
      trxsForConvToUsd
    }
  }

  async #convertCurrencies (trxs, opts) {
    const trxMapByCcy = getTrxMapByCcy(trxs)

    for (const [symbol, trxPriceCalculators] of trxMapByCcy.entries()) {
      const trxPriceCalculatorIterator = getBackIterable(trxPriceCalculators)
      let pubTrades = []

      for (const trxPriceCalculator of trxPriceCalculatorIterator) {
        const { trx } = trxPriceCalculator

        if (
          pubTrades.length === 0 ||
          pubTrades[0]?.mts > trx.mtsCreate ||
          pubTrades[pubTrades.length - 1]?.mts < trx.mtsCreate
        ) {
          pubTrades = await this.#getPublicTrades({
            symbol: `t${symbol}USD`,
            start: trx.mtsCreate - 1
          }, opts)
        }

        const pubTrade = findPublicTrade(pubTrades, trx.mtsCreate)
        trxPriceCalculator.calcPrice(pubTrade?.price)
      }
    }

    await this.#updateExactUsdValueInColls(trxs)
  }

  async #getTrades ({
    user,
    start,
    end,
    symbol
  }) {
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
        projection: this.tradesModel,
        exclude: ['user_id'],
        isExcludePrivate: false
      }
    )
  }

  async #getPublicTrades (params, opts) {
    const {
      symbol,
      start = 0,
      end = Date.now(),
      sort = 1,
      limit = 10000
    } = params ?? {}
    const { interrupter } = opts
    const args = {
      isNotMoreThanInnerMax: true,
      params: {
        symbol,
        start,
        end,
        sort,
        limit,
        notCheckNextPage: true,
        notThrowError: true
      }
    }

    const getDataFn = this.rService[this.SYNC_API_METHODS.PUBLIC_TRADES]
      .bind(this.rService)

    const res = await this.getDataFromApi({
      getData: (s, args) => getDataFn(args),
      args,
      callerName: 'TRANSACTION_TAX_REPORT',
      eNetErrorAttemptsTimeframeMin: 10,
      eNetErrorAttemptsTimeoutMs: 10000,
      interrupter
    })

    return res
  }

  async #updateExactUsdValueInColls (trxs) {
    let trades = []
    let movements = []
    let ledgers = []

    for (const [i, trx] of trxs.entries()) {
      const isLast = (i + 1) === trxs.length

      if (trx.isTrades) {
        trades.push(trx)
      }
      if (trx.isMovements) {
        movements.push(trx)
      }
      if (trx.isLedgers) {
        ledgers.push(trx)
      }

      if (
        trades.length >= 20_000 ||
        isLast
      ) {
        await this.dao.updateElemsInCollBy(
          this.ALLOWED_COLLS.TRADES,
          trades,
          ['_id'],
          ['exactUsdValue']
        )

        trades = []
      }
      if (
        movements.length >= 20_000 ||
        isLast
      ) {
        await this.dao.updateElemsInCollBy(
          this.ALLOWED_COLLS.MOVEMENTS,
          movements,
          ['_id'],
          ['exactUsdValue']
        )

        movements = []
      }
      if (
        ledgers.length >= 20_000 ||
        isLast
      ) {
        await this.dao.updateElemsInCollBy(
          this.ALLOWED_COLLS.LEDGERS,
          ledgers,
          ['_id'],
          ['exactUsdValue']
        )

        ledgers = []
      }
    }
  }
}

decorateInjectable(TransactionTaxReport, depsTypes)

module.exports = TransactionTaxReport
