'use strict'

const {
  pick,
  omit,
  isEmpty
} = require('lodash')
const {
  AuthError,
  FindMethodError
} = require('bfx-report/workers/loc.api/errors')
const {
  isAuthError,
  isNonceSmallError,
  getTimezoneConf
} = require('bfx-report/workers/loc.api/helpers')

const ReportService = require('./service.report')
const {
  ServerAvailabilityError,
  DuringSyncMethodAccessError
} = require('./errors')
const {
  checkParams,
  checkParamsAuth,
  isEnotfoundError,
  isEaiAgainError,
  emptyRes,
  collObjToArr
} = require('./helpers')

class FrameworkReportService extends ReportService {
  /**
   * @override
   */
  async _initialize (db) {
    await super._initialize()

    await this._databaseInitialize(db)
  }

  async _databaseInitialize (db) {
    await this._dao.databaseInitialize(db)
    await this._dao.updateProgress('SYNCHRONIZATION_HAS_NOT_STARTED_YET')
    await this._dao.updateStateOf(this._TABLES_NAMES.SYNC_MODE, true)
    await this._dao.updateStateOf(this._TABLES_NAMES.SCHEDULER, true)
  }

  /**
   * @override
   */
  async _getUserInfo (args) {
    try {
      const {
        username,
        timezone,
        email,
        id
      } = await this._dao.checkAuthInDb(args)

      if (
        !username ||
        typeof username !== 'string'
      ) {
        return false
      }

      return {
        username,
        timezone,
        email,
        id
      }
    } catch (err) {
      return false
    }
  }

  async _checkAuthInApi (args) {
    checkParamsAuth(args)

    const {
      email,
      timezone,
      username,
      id
    } = await super._getUserInfo(args)

    if (!email) {
      throw new AuthError()
    }

    return {
      email,
      timezone,
      username,
      id
    }
  }

  /**
   * @override
   */
  login (space, args, cb, isInnerCall) {
    return this._responder(async () => {
      let userInfo = {
        email: null,
        timezone: null,
        id: null
      }

      try {
        userInfo = await this._checkAuthInApi(args)
      } catch (err) {
        if (
          isAuthError(err) ||
          isNonceSmallError(err)
        ) {
          throw err
        }
      }

      const data = {
        ...args.auth,
        ...userInfo
      }

      const user = await this._dao.insertOrUpdateUser(data)
      const isSyncModeConfig = this.isSyncModeConfig()

      return isInnerCall
        ? { ...user, isSyncModeConfig }
        : user.email
    }, 'login', cb)
  }

  logout (space, args, cb) {
    return this._responder(async () => {
      await this._dao.deactivateUser(args.auth)

      return true
    }, 'logout', cb)
  }

  checkAuthInDb (space, args, cb) {
    return this._responder(async () => {
      const { email } = await this._dao.checkAuthInDb(args)

      return email
    }, 'checkAuthInDb', cb)
  }

  pingApi (space, args, cb) {
    return this._responder(async () => {
      try {
        const { pingMethod = '_getSymbols' } = { ...args }
        const _args = omit(args, ['pingMethod'])

        if (typeof this[pingMethod] !== 'function') {
          throw new FindMethodError()
        }

        await this[pingMethod](_args)

        return true
      } catch (err) {
        const isServerUnavailable = (
          isEnotfoundError(err) ||
          isEaiAgainError(err)
        )
        const _err = isServerUnavailable
          ? new ServerAvailabilityError(this._conf.restUrl)
          : err

        if (cb && isServerUnavailable) {
          return false
        }

        throw _err
      }
    }, 'pingApi', cb)
  }

  enableSyncMode (space, args, cb) {
    return this._responder(async () => {
      checkParamsAuth(args)

      await this._dao.updateStateOf(this._TABLES_NAMES.SYNC_MODE, true)
      await this._dao.updateUserByAuth({
        ...pick(args.auth, ['apiKey', 'apiSecret']),
        isDataFromDb: 1
      })
      await this._sync.start(true)

      return true
    }, 'enableSyncMode', cb)
  }

  disableSyncMode (space, args, cb) {
    return this._responder(async () => {
      checkParamsAuth(args)

      const { auth } = { ...args }

      await this._dao.updateUserByAuth({
        ...pick(auth, ['apiKey', 'apiSecret']),
        isDataFromDb: 0
      })
      await this._wsEventEmitter.emitRedirectingRequestsStatusToApi(
        (user) => {
          if (this._wsEventEmitter.isInvalidAuth(args, user)) {
            return null
          }

          return true
        }
      )

      return true
    }, 'disableSyncMode', cb)
  }

  isSyncModeWithDbData (space, args, cb) {
    return this._responder(async () => {
      const user = await this._dao.checkAuthInDb(args, false)
      const firstElem = await this._dao.getFirstElemInCollBy(
        this._TABLES_NAMES.SYNC_MODE
      )

      return (
        !isEmpty(firstElem) &&
        !isEmpty(user) &&
        !!firstElem.isEnable &&
        user.isDataFromDb
      )
    }, 'isSyncModeWithDbData', cb)
  }

  enableScheduler (space, args, cb) {
    return this._responder(async () => {
      await this._dao.checkAuthInDb(args)
      await this._dao.updateStateOf(this._TABLES_NAMES.SCHEDULER, true)

      return this.syncNow()
    }, 'enableScheduler', cb)
  }

  disableScheduler (space, args, cb) {
    return this._responder(async () => {
      await this._dao.checkAuthInDb(args)
      await this._dao.updateStateOf(this._TABLES_NAMES.SCHEDULER, false)

      return true
    }, 'disableScheduler', cb)
  }

  isSchedulerEnabled (space, args, cb) {
    return this._responder(async () => {
      try {
        const firstElem = await this._dao.getFirstElemInCollBy(
          this._TABLES_NAMES.SCHEDULER,
          { isEnable: 1 }
        )

        return !isEmpty(firstElem)
      } catch (err) {
        return false
      }
    }, 'isSchedulerEnabled', cb)
  }

  getSyncProgress (space, args, cb) {
    return this._responder(async () => {
      const user = await this._dao.checkAuthInDb(args, false)
      const isSchedulerEnabled = await this.isSchedulerEnabled()

      return (
        !isEmpty(user) &&
        user.isDataFromDb &&
        isSchedulerEnabled
      )
        ? this._progress.getProgress()
        : false
    }, 'getSyncProgress', cb)
  }

  syncNow (space, args = {}, cb) {
    return this._responder(async () => {
      if (cb) {
        await this._dao.checkAuthInDb(args)
      }

      const syncColls = (
        args &&
        typeof args === 'object' &&
        args.params &&
        typeof args.params === 'object' &&
        args.params.syncColls
      )
        ? args.params.syncColls
        : this._ALLOWED_COLLS.ALL

      return this._sync.start(true, syncColls)
    }, 'syncNow', cb)
  }

  getPublicTradesConf (space, args = {}, cb) {
    return this._responder(() => {
      return this._publicСollsСonfAccessors
        .getPublicСollsСonf('publicTradesConf', args)
    }, 'getPublicTradesConf', cb)
  }

  getTickersHistoryConf (space, args = {}, cb) {
    return this._responder(() => {
      return this._publicСollsСonfAccessors
        .getPublicСollsСonf('tickersHistoryConf', args)
    }, 'getTickersHistoryConf', cb)
  }

  getStatusMessagesConf (space, args = {}, cb) {
    return this._responder(() => {
      return this._publicСollsСonfAccessors
        .getPublicСollsСonf('statusMessagesConf', args)
    }, 'getStatusMessagesConf', cb)
  }

  editPublicTradesConf (space, args = {}, cb) {
    return this._responder(async () => {
      checkParams(args, 'paramsSchemaForEditPublicСollsСonf')

      await this._publicСollsСonfAccessors
        .editPublicСollsСonf('publicTradesConf', args)
      await this._sync.start(true, this._ALLOWED_COLLS.PUBLIC_TRADES)

      return true
    }, 'editPublicTradesConf', cb)
  }

  editTickersHistoryConf (space, args = {}, cb) {
    return this._responder(async () => {
      checkParams(args, 'paramsSchemaForEditPublicСollsСonf')

      await this._publicСollsСonfAccessors
        .editPublicСollsСonf('tickersHistoryConf', args)
      await this._sync.start(true, this._ALLOWED_COLLS.TICKERS_HISTORY)

      return true
    }, 'editTickersHistoryConf', cb)
  }

  editStatusMessagesConf (space, args = {}, cb) {
    return this._responder(async () => {
      checkParams(args, 'paramsSchemaForEditPublicСollsСonf')

      await this._publicСollsСonfAccessors
        .editPublicСollsСonf('statusMessagesConf', args)
      await this._sync.start(true, this._ALLOWED_COLLS.STATUS_MESSAGES)

      return true
    }, 'editStatusMessagesConf', cb)
  }

  /**
   * @override
   */
  getEmail (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        return super.getEmail(space, args)
      }

      const { email } = await this._dao.checkAuthInDb(args)

      return email
    }, 'getEmail', cb)
  }

  /**
   * @override
   */
  getUsersTimeConf (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        return super.getUsersTimeConf(space, args)
      }

      const { timezone } = await this._dao.checkAuthInDb(args)

      return getTimezoneConf(timezone)
    }, 'getUsersTimeConf', cb)
  }

  /**
   * @override
   */
  getSymbols (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        return super.getSymbols(space, args)
      }

      checkParams(args, 'paramsSchemaForApi')

      const symbolsMethod = '_getSymbols'
      const futuresMethod = '_getFutures'
      const currenciesMethod = '_getCurrencies'
      const {
        field: symbolsField
      } = this._syncSchema.getMethodCollMap().get(symbolsMethod)
      const {
        field: futuresField
      } = this._syncSchema.getMethodCollMap().get(futuresMethod)
      const symbols = await this._dao.findInCollBy(
        symbolsMethod,
        args,
        { isPublic: true }
      )
      const futures = await this._dao.findInCollBy(
        futuresMethod,
        args,
        { isPublic: true }
      )
      const currencies = await this._dao.findInCollBy(
        currenciesMethod,
        args,
        { isPublic: true }
      )

      if (
        isEmpty(symbols) &&
        isEmpty(futures) &&
        isEmpty(currencies)
      ) {
        return super.getSymbols(space, args)
      }

      const symbolsArr = collObjToArr(symbols, symbolsField)
      const futuresArr = collObjToArr(futures, futuresField)
      const pairs = [...symbolsArr, ...futuresArr]

      return { pairs, currencies }
    }, 'getSymbols', cb)
  }

  /**
   * @override
   */
  getTickersHistory (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        return super.getTickersHistory(space, args)
      }

      checkParams(args, 'paramsSchemaForApi', ['symbol'])

      const confs = await this._publicСollsСonfAccessors
        .getPublicСollsСonf(
          'tickersHistoryConf',
          args
        )

      if (isEmpty(confs)) {
        return emptyRes()
      }

      const _args = this._publicСollsСonfAccessors
        .getArgs(confs, args)

      return this._dao.findInCollBy(
        '_getTickersHistory',
        _args,
        {
          isPrepareResponse: true,
          isPublic: true
        }
      )
    }, 'getTickersHistory', cb)
  }

  /**
   * @override
   */
  getPositionsHistory (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        return super.getPositionsHistory(space, args)
      }

      checkParams(args, 'paramsSchemaForApi')

      return this._dao.findInCollBy(
        '_getPositionsHistory',
        args,
        {
          isPrepareResponse: true
        }
      )
    }, 'getPositionsHistory', cb)
  }

  /**
   * @override
   */
  getLedgers (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        const { isMarginFundingPayment } = { ...args.params }

        if (isMarginFundingPayment) {
          throw new DuringSyncMethodAccessError()
        }

        return super.getLedgers(space, args)
      }

      checkParams(args, 'paramsSchemaForApi')

      return this._dao.findInCollBy(
        '_getLedgers',
        args,
        {
          isPrepareResponse: true
        }
      )
    }, 'getLedgers', cb)
  }

  /**
   * @override
   */
  getTrades (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        return super.getTrades(space, args)
      }

      checkParams(args, 'paramsSchemaForApi')

      return this._dao.findInCollBy(
        '_getTrades',
        args,
        {
          isPrepareResponse: true
        }
      )
    }, 'getTrades', cb)
  }

  /**
   * @override
   */
  getFundingTrades (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        return super.getFundingTrades(space, args)
      }

      checkParams(args, 'paramsSchemaForApi')

      return this._dao.findInCollBy(
        '_getFundingTrades',
        args,
        {
          isPrepareResponse: true
        }
      )
    }, 'getFundingTrades', cb)
  }

  /**
   * @override
   */
  getPublicTrades (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        return super.getPublicTrades(space, args)
      }

      checkParams(args, 'paramsSchemaForPublicTrades', ['symbol'])

      const confs = await this._publicСollsСonfAccessors
        .getPublicСollsСonf(
          'publicTradesConf',
          args
        )

      if (isEmpty(confs)) {
        return emptyRes()
      }

      const _args = this._publicСollsСonfAccessors
        .getArgs(confs, args)

      return this._dao.findInCollBy(
        '_getPublicTrades',
        _args,
        {
          isPrepareResponse: true,
          isPublic: true
        }
      )
    }, 'getPublicTrades', cb)
  }

  /**
   * @override
   */
  getStatusMessages (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        return super.getStatusMessages(space, args)
      }

      checkParams(args, 'paramsSchemaForStatusMessagesApi')

      const { params } = { ...args }
      const {
        type = 'deriv',
        symbol = ['ALL']
      } = { ...params }
      const preparedArgs = {
        ...args,
        params: {
          ...params,
          type,
          symbol: (
            symbol === 'ALL' ||
            (
              Array.isArray(symbol) &&
              symbol[0] === 'ALL'
            )
          )
            ? null
            : symbol
        }
      }

      const confs = await this._publicСollsСonfAccessors
        .getPublicСollsСonf(
          'statusMessagesConf',
          preparedArgs
        )

      if (isEmpty(confs)) {
        return emptyRes()
      }

      const _args = this._publicСollsСonfAccessors
        .getArgs(confs, preparedArgs)

      return this._dao.findInCollBy(
        '_getStatusMessages',
        _args,
        {
          isPrepareResponse: true,
          isPublic: true
        }
      )
    }, 'getStatusMessages', cb)
  }

  /**
   * @override
   */
  getOrderTrades (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        return super.getOrderTrades(space, args)
      }

      checkParams(args, 'paramsSchemaForOrderTradesApi')

      const { id: orderID } = { ...args.params }

      return this._dao.findInCollBy(
        '_getTrades',
        args,
        {
          isPrepareResponse: true,
          schema: {
            additionalFilteringProps: { orderID }
          }
        }
      )
    }, 'getOrderTrades', cb)
  }

  /**
   * @override
   */
  getOrders (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        return super.getOrders(space, args)
      }

      checkParams(args, 'paramsSchemaForApi')

      return this._dao.findInCollBy(
        '_getOrders',
        args,
        {
          isPrepareResponse: true
        }
      )
    }, 'getOrders', cb)
  }

  /**
   * @override
   */
  getMovements (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        return super.getMovements(space, args)
      }

      checkParams(args, 'paramsSchemaForApi')

      return this._dao.findInCollBy(
        '_getMovements',
        args,
        {
          isPrepareResponse: true
        }
      )
    }, 'getMovements', cb)
  }

  /**
   * @override
   */
  getFundingOfferHistory (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        return super.getFundingOfferHistory(space, args)
      }

      checkParams(args, 'paramsSchemaForApi')

      return this._dao.findInCollBy(
        '_getFundingOfferHistory',
        args,
        {
          isPrepareResponse: true
        }
      )
    }, 'getFundingOfferHistory', cb)
  }

  /**
   * @override
   */
  getFundingLoanHistory (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        return super.getFundingLoanHistory(space, args)
      }

      checkParams(args, 'paramsSchemaForApi')

      return this._dao.findInCollBy(
        '_getFundingLoanHistory',
        args,
        {
          isPrepareResponse: true
        }
      )
    }, 'getFundingLoanHistory', cb)
  }

  /**
   * @override
   */
  getFundingCreditHistory (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        return super.getFundingCreditHistory(space, args)
      }

      checkParams(args, 'paramsSchemaForApi')

      return this._dao.findInCollBy(
        '_getFundingCreditHistory',
        args,
        {
          isPrepareResponse: true
        }
      )
    }, 'getFundingCreditHistory', cb)
  }

  /**
   * @override
   */
  getWallets (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        throw new DuringSyncMethodAccessError()
      }

      checkParams(args, 'paramsSchemaForWallets')

      return this._wallets.getWallets(args)
    }, 'getWallets', cb)
  }

  getBalanceHistory (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        throw new DuringSyncMethodAccessError()
      }

      checkParams(args, 'paramsSchemaForBalanceHistoryApi')

      return this._balanceHistory.getBalanceHistory(args)
    }, 'getBalanceHistory', cb)
  }

  getWinLoss (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        throw new DuringSyncMethodAccessError()
      }

      checkParams(args, 'paramsSchemaForWinLossApi')

      return this._winLoss.getWinLoss(args)
    }, 'getWinLoss', cb)
  }

  getPositionsSnapshot (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        throw new DuringSyncMethodAccessError()
      }

      checkParams(args, 'paramsSchemaForPositionsSnapshotApi')

      return this._positionsSnapshot.getPositionsSnapshot(args)
    }, 'getPositionsSnapshot', cb)
  }

  getFullSnapshotReport (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        throw new DuringSyncMethodAccessError()
      }

      checkParams(args, 'paramsSchemaForFullSnapshotReportApi')

      return this._fullSnapshotReport.getFullSnapshotReport(args)
    }, 'getFullSnapshotReport', cb)
  }

  getFullTaxReport (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        throw new DuringSyncMethodAccessError()
      }

      checkParams(args, 'paramsSchemaForFullTaxReportApi')

      return this._fullTaxReport.getFullTaxReport(args)
    }, 'getFullTaxReport', cb)
  }

  getTradedVolume (space, args, cb) {
    return this._responder(async () => {
      if (!await this.isSyncModeWithDbData(space, args)) {
        throw new DuringSyncMethodAccessError()
      }

      checkParams(args, 'paramsSchemaForTradedVolumeApi')

      return this._tradedVolume.getTradedVolume(args)
    }, 'getTradedVolume', cb)
  }

  /**
   * @override
   */
  getMultipleCsv (space, args, cb) {
    return this._responder(() => {
      return this._generateCsv(
        'getMultipleCsvJobData',
        args
      )
    }, 'getMultipleCsv', cb)
  }

  getBalanceHistoryCsv (space, args, cb) {
    return this._responder(() => {
      return this._generateCsv(
        'getBalanceHistoryCsvJobData',
        args
      )
    }, 'getBalanceHistoryCsv', cb)
  }

  getWinLossCsv (space, args, cb) {
    return this._responder(() => {
      return this._generateCsv(
        'getWinLossCsvJobData',
        args
      )
    }, 'getWinLossCsv', cb)
  }

  getPositionsSnapshotCsv (space, args, cb) {
    return this._responder(() => {
      return this._generateCsv(
        'getPositionsSnapshotCsvJobData',
        args
      )
    }, 'getPositionsSnapshotCsv', cb)
  }

  getFullSnapshotReportCsv (space, args, cb) {
    return this._responder(() => {
      return this._generateCsv(
        'getFullSnapshotReportCsvJobData',
        args
      )
    }, 'getFullSnapshotReportCsv', cb)
  }

  getFullTaxReportCsv (space, args, cb) {
    return this._responder(() => {
      return this._generateCsv(
        'getFullTaxReportCsvJobData',
        args
      )
    }, 'getFullTaxReportCsv', cb)
  }

  getTradedVolumeCsv (space, args, cb) {
    return this._responder(() => {
      return this._generateCsv(
        'getTradedVolumeCsvJobData',
        args
      )
    }, 'getTradedVolumeCsv', cb)
  }
}

module.exports = FrameworkReportService
