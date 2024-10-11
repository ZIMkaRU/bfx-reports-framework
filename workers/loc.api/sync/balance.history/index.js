'use strict'

const { isEmpty } = require('lib-js-util-base')
const moment = require('moment')

const {
  calcGroupedData,
  getMtsGroupedByTimeframe,
  groupByTimeframe,
  isForexSymb
} = require('../helpers')
const { getTimeframeQuery } = require('../dao/helpers')

const { decorateInjectable } = require('../../di/utils')

const depsTypes = (TYPES) => [
  TYPES.DAO,
  TYPES.Wallets,
  TYPES.FOREX_SYMBS,
  TYPES.CurrencyConverter,
  TYPES.SYNC_API_METHODS,
  TYPES.ALLOWED_COLLS,
  TYPES.Authenticator,
  TYPES.PositionsSnapshot
]
class BalanceHistory {
  constructor (
    dao,
    wallets,
    FOREX_SYMBS,
    currencyConverter,
    SYNC_API_METHODS,
    ALLOWED_COLLS,
    authenticator,
    positionsSnapshot
  ) {
    this.dao = dao
    this.wallets = wallets
    this.FOREX_SYMBS = FOREX_SYMBS
    this.currencyConverter = currencyConverter
    this.SYNC_API_METHODS = SYNC_API_METHODS
    this.ALLOWED_COLLS = ALLOWED_COLLS
    this.authenticator = authenticator
    this.positionsSnapshot = positionsSnapshot
  }

  _groupWalletsByCurrency (wallets = []) {
    return wallets.reduce((
      accum,
      { currency, balance }
    ) => {
      if (!Number.isFinite(balance)) {
        return { ...accum }
      }

      return {
        ...accum,
        [currency]: (Number.isFinite(accum[currency]))
          ? accum[currency] + balance
          : balance
      }
    }, {})
  }

  _calcWalletsInTimeframe (firstWallets) {
    let wallets = [...firstWallets]

    return (data) => {
      const missingWallets = wallets.filter(w => (
        data.every(({ type, currency }) => (
          w.type !== type || w.currency !== currency
        ))
      ))

      wallets = [...data, ...missingWallets]

      return this._groupWalletsByCurrency(wallets)
    }
  }

  async _getWallets (args = {}) {
    const {
      auth,
      params
    } = args ?? {}
    const {
      start = 0,
      end = Date.now(),
      timeframe = 'day'
    } = params ?? {}

    const sqlTimeframe = getTimeframeQuery(timeframe)
    const schema = {
      groupResBy: ['wallet', 'currency', 'timeframe'],
      dataStructureConverter: (accum, {
        wallet: type,
        currency,
        balance,
        balanceUsd,
        mts: mtsUpdate,
        timeframe
      } = {}) => {
        if (
          !type ||
          typeof type !== 'string' ||
          !Number.isFinite(balance) ||
          typeof currency !== 'string' ||
          currency.length < 3
        ) {
          return accum
        }

        accum.push({
          type,
          currency,
          balance,
          balanceUsd,
          timeframe,
          mtsUpdate
        })

        return accum
      }
    }

    const res = await this.dao.findInCollBy(
      this.SYNC_API_METHODS.WALLETS,
      {
        auth,
        params: { start, end }
      },
      {
        additionalModel: { [sqlTimeframe]: '' },
        schema
      }
    )

    if (timeframe !== 'week') {
      return res
    }

    return this._reGroupWeeklyDataGroups(res)
  }

  /*
   * There need to re-group weekly data groups
   * if the weekly timeframe hits on the transition
   * from one year to another
   * The reason:
   *   - the sqlite `strftime` function
   * https://www.sqlite.org/lang_datefunc.html
   * https://pubs.opengroup.org/onlinepubs/007908799/xsh/strftime.html
   * works differently compared MomentJS implementation
   * with weeks of year https://momentjs.com/docs/#/get-set/iso-week-year
   *   - for `strftime`, the week is number of the year
   * (Monday as the first day of the week)
   * as a decimal number [00,53]
   * All days in a new year preceding the first Monday
   * are considered to be in week 0
   *  - for MomentJS (ISO 8601 week date),
   * if 31 December is on a Monday, Tuesday, or Wednesday
   * it is in W01 of the next year
   * https://en.wikipedia.org/wiki/ISO_week_date#Last_week
   * https://en.wikipedia.org/wiki/ISO_week_date#First_week
   *
   * Take into consideration sqlite peculiarity we can have
   * wrong and redundant week data groups at the end/start of the year
   */
  _reGroupWeeklyDataGroups (data) {
    let unicGroup = []

    return data.reduce((accum, item, i) => {
      const isLast = (i + 1) === data.length

      const date = moment.utc(item?.mtsUpdate)
      const month = date.month()
      const dates = date.date()
      const weekday = date.isoWeekday()

      if (
        (
          month === 0 &&
          dates < 7 &&
          (weekday - dates) > 0
        ) ||
        (
          month === 11 &&
          dates > 25 &&
          (dates + 7 - weekday) > 31
        )
      ) {
        if (unicGroup.some((w) => (
          w?.currency === item?.currency &&
          w?.wallet === item?.wallet
        ))) {
          return accum
        }

        unicGroup.push(item)

        if (
          isLast &&
          unicGroup.length > 0
        ) {
          accum.push(...unicGroup)
          unicGroup = []
        }

        return accum
      }
      if (unicGroup.length > 0) {
        accum.push(...unicGroup)
        unicGroup = []
      }

      accum.push(item)

      return accum
    }, [])
  }

  _getCandles (args = {}) {
    const {
      start = 0,
      end = Date.now()
    } = args?.params ?? {}

    const mtsMoment = moment.utc(start)
      .add(-1, 'days')
      .valueOf()
    const _start = start
      ? mtsMoment
      : start

    return this.dao.getElemsInCollBy(
      this.ALLOWED_COLLS.CANDLES,
      {
        filter: {
          $eq: { _timeframe: '1D' },
          $lte: { mts: end },
          $gte: { mts: _start }
        },
        sort: [['mts', -1]],
        projection: ['mts', 'close', '_symbol']
      }
    )
  }

  _getCandlesClosePrice (
    candles,
    mts,
    timeframe,
    symb,
    currenciesSynonymous
  ) {
    const mtsMoment = moment.utc(mts)

    if (timeframe === 'day') {
      mtsMoment.add(1, 'days')
    }
    if (timeframe === 'month') {
      mtsMoment.add(1, 'months')
    }
    if (timeframe === 'week') {
      mtsMoment.add(1, 'weeks')
      mtsMoment.isoWeekday(1)
    }
    if (timeframe === 'year') {
      mtsMoment.add(1, 'years')
    }

    const _mts = mtsMoment.valueOf() - 1
    const symbSeparator = symb.length > 3
      ? ':'
      : ''

    const price = this.currencyConverter.getPriceFromData(
      `t${symb}${symbSeparator}USD`,
      _mts,
      { candles, currenciesSynonymous }
    )

    return price
  }

  _getWalletsByTimeframe (
    firstWallets,
    candles,
    timeframe,
    currenciesSynonymous
  ) {
    let prevRes = { ...firstWallets }

    return ({
      walletsGroupedByTimeframe = {},
      mtsGroupedByTimeframe: { mts } = {},
      plGroupedByTimeframe = {}
    } = {}) => {
      const isReturnedPrevRes = (
        isEmpty(walletsGroupedByTimeframe) &&
        !isEmpty(prevRes)
      )

      const walletsArr = isReturnedPrevRes
        ? Object.entries(prevRes)
        : Object.entries(walletsGroupedByTimeframe)
      const res = walletsArr.reduce((
        accum,
        [currency, balance]
      ) => {
        const _isForexSymb = isForexSymb(currency, this.FOREX_SYMBS)
        const price = _isForexSymb
          ? null
          : this._getCandlesClosePrice(
            candles,
            mts,
            timeframe,
            currency,
            currenciesSynonymous
          )

        if (!_isForexSymb && !Number.isFinite(price)) {
          return accum
        }

        const _balance = _isForexSymb
          ? balance
          : balance * price
        const symb = _isForexSymb
          ? currency
          : 'USD'

        if (!Number.isFinite(_balance)) {
          return accum
        }

        const val = (Number.isFinite(accum[symb]))
          ? accum[symb] + _balance
          : _balance

        return Object.assign(accum, { [symb]: val })
      }, {})

      if (!isReturnedPrevRes) {
        prevRes = { ...walletsGroupedByTimeframe }
      }

      const usdPL = Number.isFinite(plGroupedByTimeframe?.USD)
        ? plGroupedByTimeframe.USD
        : 0
      const usdRes = this._convertForexToUsd(
        res,
        candles,
        mts,
        timeframe,
        currenciesSynonymous
      )

      return { USD: usdRes + usdPL }
    }
  }

  _convertForexToUsd (
    obj,
    candles,
    mts,
    timeframe,
    currenciesSynonymous
  ) {
    const dataArr = Object.entries(obj)

    if (dataArr.length === 0) {
      return 0
    }

    const resInUsd = dataArr.reduce((accum, [symb, balance]) => {
      if (symb === 'USD') {
        return accum + balance
      }

      const price = this._getCandlesClosePrice(
        candles,
        mts,
        timeframe,
        symb,
        currenciesSynonymous
      )

      if (
        !Number.isFinite(price) ||
        !Number.isFinite(balance)
      ) {
        return accum
      }

      return accum + balance * price
    }, 0)

    return resInUsd
  }

  async _getWalletsGroupedByOneTimeframe (
    args,
    isSubCalc
  ) {
    const {
      params: { end } = {}
    } = { ...args }
    const startWallets = this.FOREX_SYMBS
      .reduce((accum, symb) => {
        return {
          ...accum,
          [symb]: 0
        }
      }, {})
    const lastWallets = await this.wallets.getWallets(args)

    const res = lastWallets.reduce((accum, movement = {}) => {
      const { balance, balanceUsd, currency } = { ...movement }
      const _isForexSymb = isForexSymb(currency, this.FOREX_SYMBS)
      const _isNotUsedBalanceUsdField = (
        _isForexSymb &&
        !Number.isFinite(balanceUsd)
      )
      const _balance = _isNotUsedBalanceUsdField
        ? balance
        : balanceUsd
      const symb = _isNotUsedBalanceUsdField
        ? currency
        : 'USD'

      if (!Number.isFinite(_balance)) {
        return { ...accum }
      }

      return {
        ...accum,
        [symb]: (Number.isFinite(accum[symb]))
          ? accum[symb] + _balance
          : _balance
      }
    }, startWallets)
    const vals = isSubCalc
      ? { vals: res }
      : res

    return [{
      mts: end,
      ...vals
    }]
  }

  async _getStartingMts (args) {
    return Number.isInteger(args?.params?.start)
      ? args.params.start
      : await this.wallets.getFirstWalletsMts(args)
  }

  async getBalanceHistory (
    {
      auth: _auth = {},
      params = {}
    } = {},
    opts = {}
  ) {
    const auth = await this.authenticator
      .verifyRequestUser({ auth: _auth })

    const {
      timeframe = 'day',
      start = 0,
      end = Date.now(),
      isUnrealizedProfitExcluded
    } = params ?? {}
    const {
      isSubCalc = false
    } = opts ?? {}

    if (Number.isInteger(timeframe)) {
      return this._getWalletsGroupedByOneTimeframe(
        {
          auth,
          params: { end }
        },
        isSubCalc
      )
    }

    const args = {
      auth,
      params: {
        timeframe,
        start,
        end
      }
    }

    const plGroupedByTimeframePromise = isUnrealizedProfitExcluded
      ? []
      : this.positionsSnapshot.getPLSnapshot(args)

    const firstWalletsPromise = this.wallets.getWallets({
      auth,
      params: { end: start }
    })
    const walletsPromise = this._getWallets(args)
    const candlesPromise = this._getCandles(args)

    const [
      firstWallets,
      wallets,
      candles,
      plGroupedByTimeframe
    ] = await Promise.all([
      firstWalletsPromise,
      walletsPromise,
      candlesPromise,
      plGroupedByTimeframePromise
    ])

    const firstWalletsGroupedByCurrency = this._groupWalletsByCurrency(
      firstWallets
    )
    const walletsGroupedByTimeframe = await groupByTimeframe(
      wallets,
      { timeframe, start, end },
      this.FOREX_SYMBS,
      'mtsUpdate',
      'currency',
      this._calcWalletsInTimeframe(firstWallets)
    )
    const startingMts = await this._getStartingMts(args)
    const mtsGroupedByTimeframe = getMtsGroupedByTimeframe(
      startingMts,
      end,
      timeframe,
      true
    )

    const currenciesSynonymous = await this.currencyConverter
      .getCurrenciesSynonymous()

    const res = await calcGroupedData(
      {
        walletsGroupedByTimeframe,
        mtsGroupedByTimeframe,
        plGroupedByTimeframe
      },
      isSubCalc,
      this._getWalletsByTimeframe(
        firstWalletsGroupedByCurrency,
        candles,
        timeframe,
        currenciesSynonymous
      ),
      true
    )

    return res
  }
}

decorateInjectable(BalanceHistory, depsTypes)

module.exports = BalanceHistory
