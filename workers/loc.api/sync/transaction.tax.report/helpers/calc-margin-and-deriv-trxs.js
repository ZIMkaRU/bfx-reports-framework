'use strict'

const BigNumber = require('bignumber.js')
const { setImmediate } = require('node:timers/promises')
const splitSymbolPairs = require(
  'bfx-report/workers/loc.api/helpers/split-symbol-pairs'
)

const {
  CurrencyConversionError,
  CurrencyPairSeparationError
} = require('../../../errors')

const calcTotalBuyAmount = (
  mapOfLastProcessedTradesByPairs,
  trade
) => {
  const prevTrade = mapOfLastProcessedTradesByPairs.get(trade.symbol)
  const currAmount = trade.isBuyTrx
    ? new BigNumber(trade.execAmount)
    : new BigNumber(0)

  if (!(prevTrade?.totalBuyAmount instanceof BigNumber)) {
    return currAmount
  }

  return prevTrade.totalBuyAmount.plus(currAmount)
}

const calcTotalCostUsd = (
  mapOfLastProcessedTradesByPairs,
  trade
) => {
  const prevTrade = mapOfLastProcessedTradesByPairs.get(trade.symbol)
  const currAmount = trade.isBuyTrx
    ? new BigNumber(trade.execAmount)
    : new BigNumber(0)
  const currPriceUsd = trade.isBuyTrx
    ? new BigNumber(trade.firstSymbPriceUsd)
    : new BigNumber(0)

  if (!(prevTrade?.totalCostUsd instanceof BigNumber)) {
    return currAmount.times(currPriceUsd)
  }

  return prevTrade.totalCostUsd
    .plus(currAmount.times(currPriceUsd))
}

const calcBuyWeightedPriceUsd = (trade) => {
  if (
    !(trade?.totalBuyAmount instanceof BigNumber) ||
    !(trade?.totalCostUsd instanceof BigNumber) ||
    trade.totalBuyAmount.eq(0) ||
    trade.totalCostUsd.eq(0)
  ) {
    return new BigNumber(0)
  }

  return trade.totalCostUsd.div(trade.totalBuyAmount)
}

const calcTotalSellAmount = (
  mapOfLastProcessedTradesByPairs,
  trade
) => {
  const prevTrade = mapOfLastProcessedTradesByPairs.get(trade.symbol)
  const currAmount = trade.isSaleTrx
    ? new BigNumber(trade.execAmount).abs()
    : new BigNumber(0)

  if (!(prevTrade?.totalSellAmount instanceof BigNumber)) {
    return currAmount
  }

  return prevTrade.totalSellAmount.plus(currAmount)
}

const calcTotalProceedsUsd = (
  mapOfLastProcessedTradesByPairs,
  trade
) => {
  const prevTrade = mapOfLastProcessedTradesByPairs.get(trade.symbol)
  const currAmount = trade.isSaleTrx
    ? new BigNumber(trade.execAmount).abs()
    : new BigNumber(0)
  const currPriceUsd = trade.isSaleTrx
    ? new BigNumber(trade.firstSymbPriceUsd)
    : new BigNumber(0)

  if (!(prevTrade?.totalProceedsUsd instanceof BigNumber)) {
    return currAmount.times(currPriceUsd)
  }

  return prevTrade.totalProceedsUsd
    .plus(currAmount.times(currPriceUsd))
}

const calcSellWeightedPriceUsd = (trade) => {
  if (
    !(trade?.totalSellAmount instanceof BigNumber) ||
    !(trade?.totalProceedsUsd instanceof BigNumber) ||
    trade.totalSellAmount.eq(0) ||
    trade.totalProceedsUsd.eq(0)
  ) {
    return new BigNumber(0)
  }

  return trade.totalProceedsUsd.div(trade.totalSellAmount)
}

// TODO:
module.exports = async (trades, opts) => {
  const {
    interrupter
  } = opts ?? {}

  // TODO: mocked deriv
  const res = [
    {
      asset: 'BTCF0:USTF0',
      amount: 123,
      mtsAcquired: null,
      mtsSold: null,
      proceeds: 200,
      cost: 100,
      gainOrLoss: 123,
      type: 'DERIVATIVE'
    }
  ]

  if (
    !Array.isArray(trades) ||
    trades.length === 0
  ) {
    return res
  }

  const mapOfLastProcessedTradesByPairs = new Map()
  let lastLoopUnlockMts = Date.now()

  for (const trade of trades) {
    if (interrupter?.hasInterrupted()) {
      return res
    }

    const currentLoopUnlockMts = Date.now()

    /*
     * Trx hist restoring is a hard sync operation,
     * to prevent EventLoop locking more than 1sec
     * it needs to resolve async queue
     */
    if ((currentLoopUnlockMts - lastLoopUnlockMts) > 1000) {
      await setImmediate()

      lastLoopUnlockMts = currentLoopUnlockMts
    }

    trade.totalBuyAmount = trade
      .totalBuyAmount ?? new BigNumber(0)
    trade.totalCostUsd = trade
      .totalCostUsd ?? new BigNumber(0)
    trade.buyWeightedPriceUsd = trade
      .buyWeightedPriceUsd ?? new BigNumber(0)
    trade.totalSellAmount = trade
      .totalSellAmount ?? new BigNumber(0)
    trade.totalProceedsUsd = trade
      .totalProceedsUsd ?? new BigNumber(0)
    trade.sellWeightedPriceUsd = trade
      .sellWeightedPriceUsd ?? new BigNumber(0)

    if (
      !trade?.symbol ||
      !Number.isFinite(trade?.execPrice) ||
      !Number.isFinite(trade?.execAmount) ||
      trade.execAmount === 0
    ) {
      continue
    }

    const [firstSymb, lastSymb] = (
      trade?.firstSymb &&
      trade?.lastSymb
    )
      ? [trade?.firstSymb, trade?.lastSymb]
      : splitSymbolPairs(trade.symbol)
    trade.firstSymb = firstSymb
    trade.lastSymb = lastSymb

    trade.isSaleTrx = trade.execAmount < 0
    trade.isBuyTrx = trade.execAmount > 0

    if (
      !firstSymb ||
      !lastSymb
    ) {
      throw new CurrencyPairSeparationError({
        symbol: trade.symbol,
        firstSymb,
        lastSymb
      })
    }
    if (!Number.isFinite(trade.firstSymbPriceUsd)) {
      throw new CurrencyConversionError({
        symbol: firstSymb,
        priceUsd: trade.firstSymbPriceUsd
      })
    }
    if (!Number.isFinite(trade.lastSymbPriceUsd)) {
      throw new CurrencyConversionError({
        symbol: lastSymb,
        priceUsd: trade.lastSymbPriceUsd
      })
    }

    trade.totalBuyAmount = calcTotalBuyAmount(
      mapOfLastProcessedTradesByPairs,
      trade
    )
    trade.totalCostUsd = calcTotalCostUsd(
      mapOfLastProcessedTradesByPairs,
      trade
    )
    trade.buyWeightedPriceUsd = calcBuyWeightedPriceUsd(trade)
    trade.totalSellAmount = calcTotalSellAmount(
      mapOfLastProcessedTradesByPairs,
      trade
    )
    trade.totalProceedsUsd = calcTotalProceedsUsd(
      mapOfLastProcessedTradesByPairs,
      trade
    )
    trade.sellWeightedPriceUsd = calcSellWeightedPriceUsd(trade)

    mapOfLastProcessedTradesByPairs.set(trade.symbol, trade)
  }

  return res
}
