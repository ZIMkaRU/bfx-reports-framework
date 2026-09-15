'use strict'

const INTERRUPTER_NAMES = require(
  '@bitfinex/bfx-report/workers/loc.api/interrupter/interrupter.names'
)

const { decorateInjectable } = require('../../di/utils')

const depsTypes = (TYPES) => [
  TYPES.Wallets,
  TYPES.PositionsSnapshot,
  TYPES.InterrupterFactory
]
class FullSnapshotReport {
  constructor (
    wallets,
    positionsSnapshot,
    interrupterFactory
  ) {
    this.wallets = wallets
    this.positionsSnapshot = positionsSnapshot
    this.interrupterFactory = interrupterFactory
  }

  _getWalletsTickers (walletsSnapshot = []) {
    if (!Array.isArray(walletsSnapshot)) {
      return []
    }

    return walletsSnapshot.reduce((accum, wallet) => {
      const {
        type: walletType,
        currency,
        balance,
        balanceUsd
      } = { ...wallet }

      if (
        currency === 'USD' ||
        !Number.isFinite(balance) ||
        !Number.isFinite(balanceUsd) ||
        balance === 0 ||
        balanceUsd === 0
      ) {
        return accum
      }

      const separator = currency.length > 3
        ? ':'
        : ''
      const symbol = `t${currency}${separator}USD`

      accum.push({
        walletType,
        symbol,
        amount: balanceUsd / balance
      })

      return accum
    }, [])
  }

  _calcObjFieldInArr (array, fieldName) {
    if (
      !Array.isArray(array) ||
      array.length === 0
    ) {
      return null
    }

    return array.reduce((accum, curr) => {
      const obj = { ...curr }
      const fieldVal = obj[fieldName]

      if (!Number.isFinite(fieldVal)) {
        return accum
      }

      return Number.isFinite(accum)
        ? accum + fieldVal
        : fieldVal
    }, 0)
  }

  _calcPositionsTotalPlUsd (positionsSnapshot) {
    return this._calcObjFieldInArr(
      positionsSnapshot,
      'plUsd'
    )
  }

  _calcWalletsTotalBalanceUsd (walletsSnapshot) {
    return this._calcObjFieldInArr(
      walletsSnapshot,
      'balanceUsd'
    )
  }

  async getFullSnapshotReport (args) {
    const { auth, params } = args ?? {}
    const end = params.end ?? Date.now()
    const user = await this.authenticator
      .verifyRequestUser({ auth })
    // TODO:
    const interrupter = this.interrupterFactory({
      user,
      name: INTERRUPTER_NAMES.FULL_SNAPSHOT_REPORT_INTERRUPTER
    })

    const _args = {
      ...args,
      auth: user,
      params: {
        ...params,
        end
      }
    }

    const positionsSnapshotAndTickersPromise = this.positionsSnapshot
      .getPositionsSnapshotAndTickers(_args)
    const walletsSnapshotPromise = this.wallets
      .getWalletsConvertedByPublicTrades(_args)
    const [
      positionsSnapshotAndTickers,
      walletsSnapshot
    ] = await Promise.all([
      positionsSnapshotAndTickersPromise,
      walletsSnapshotPromise
    ])
    const {
      positionsSnapshot,
      tickers: positionsTickers
    } = positionsSnapshotAndTickers

    const walletsTickersPromise = this._getWalletsTickers(
      walletsSnapshot
    )
    const positionsTotalPlUsdPromise = this._calcPositionsTotalPlUsd(
      positionsSnapshot
    )
    const walletsTotalBalanceUsdPromise = this._calcWalletsTotalBalanceUsd(
      walletsSnapshot
    )
    const [
      walletsTickers,
      positionsTotalPlUsd,
      walletsTotalBalanceUsd
    ] = await Promise.all([
      walletsTickersPromise,
      positionsTotalPlUsdPromise,
      walletsTotalBalanceUsdPromise
    ])

    return {
      timestamps: {
        mtsCreated: Date.now(),
        end
      },
      positionsSnapshot,
      walletsSnapshot,
      positionsTickers,
      walletsTickers,
      positionsTotalPlUsd,
      walletsTotalBalanceUsd
    }
  }
}

decorateInjectable(FullSnapshotReport, depsTypes)

module.exports = FullSnapshotReport
