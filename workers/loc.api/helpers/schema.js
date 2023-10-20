'use strict'

const { cloneDeep } = require('lodash')

const {
  paramsSchemaForCsv,
  paramsSchemaForCandlesApi: baseParamsSchemaForCandlesApi
} = require('bfx-report/workers/loc.api/helpers/schema')

const subAccountApiKeys = {
  type: 'array',
  minItems: 1,
  maxItems: 300,
  items: {
    type: 'object',
    properties: {
      apiKey: { type: 'string' },
      apiSecret: { type: 'string' },
      token: { type: 'string' },
      email: { type: 'string' }
    }
  }
}

const paramsSchemaForCreateSubAccount = {
  type: 'object',
  required: ['subAccountApiKeys'],
  properties: {
    subAccountApiKeys,
    subAccountPassword: { type: 'string' }
  }
}

const paramsSchemaForUpdateSubAccount = {
  type: 'object',
  properties: {
    addingSubUsers: subAccountApiKeys,
    removingSubUsersByEmails: {
      type: 'array',
      minItems: 1,
      maxItems: 300,
      items: {
        type: 'object',
        properties: {
          email: { type: 'string' }
        }
      }
    }
  }
}

const paramsSchemaForCandlesApi = {
  ...cloneDeep(baseParamsSchemaForCandlesApi),
  properties: {
    ...cloneDeep(baseParamsSchemaForCandlesApi.properties),
    section: {
      type: 'string',
      enum: ['hist']
    }
  }
}

const paramsSchemaForEditAllPublicСollsСonfs = {
  type: 'object',
  properties: {
    candlesConf: {
      type: 'array',
      items: {
        type: 'object',
        required: ['symbol', 'start', 'timeframe'],
        properties: {
          start: { type: 'integer' },
          symbol: { type: 'string' },
          timeframe: { type: 'string' }
        }
      }
    },
    statusMessagesConf: {
      type: 'array',
      items: {
        type: 'object',
        required: ['symbol', 'start'],
        properties: {
          start: { type: 'integer' },
          symbol: { type: 'string' }
        }
      }
    },
    tickersHistoryConf: {
      type: 'array',
      items: {
        type: 'object',
        required: ['symbol', 'start'],
        properties: {
          start: { type: 'integer' },
          symbol: { type: 'string' }
        }
      }
    },
    publicTradesConf: {
      type: 'array',
      items: {
        type: 'object',
        required: ['symbol', 'start'],
        properties: {
          start: { type: 'integer' },
          symbol: { type: 'string' }
        }
      }
    }
  }
}

const paramsSchemaForEditPublicСollsСonf = {
  type: ['array', 'object'],
  if: {
    type: 'array'
  },
  then: {
    minItems: 1,
    items: {
      type: 'object',
      required: ['symbol', 'start'],
      properties: {
        symbol: { type: 'string' },
        start: { type: 'integer' }
      }
    }
  },
  else: {
    required: ['symbol', 'start'],
    properties: {
      symbol: { type: 'string' },
      start: { type: 'integer' }
    }
  }
}

const paramsSchemaForEditCandlesСonf = {
  type: ['array', 'object'],
  if: {
    type: 'array'
  },
  then: {
    minItems: 1,
    items: {
      type: 'object',
      required: ['symbol', 'start', 'timeframe'],
      properties: {
        symbol: { type: 'string' },
        start: { type: 'integer' },
        timeframe: { type: 'string' }
      }
    }
  },
  else: {
    required: ['symbol', 'start', 'timeframe'],
    properties: {
      symbol: { type: 'string' },
      start: { type: 'integer' },
      timeframe: { type: 'string' }
    }
  }
}

const paramsSchemaForBalanceHistoryApi = {
  type: 'object',
  properties: {
    timeframe: {
      type: 'string',
      enum: [
        'day',
        'week',
        'month',
        'year'
      ]
    },
    start: {
      type: 'integer'
    },
    end: {
      type: 'integer'
    }
  }
}

const paramsSchemaForPositionsSnapshotApi = {
  type: 'object',
  properties: {
    end: {
      type: 'integer'
    }
  }
}

const paramsSchemaForFullSnapshotReportApi = {
  type: 'object',
  properties: {
    end: {
      type: 'integer'
    }
  }
}

const paramsSchemaForFullTaxReportApi = {
  type: 'object',
  properties: {
    end: {
      type: 'integer'
    },
    start: {
      type: 'integer'
    }
  }
}

const paramsSchemaForWinLossApi = {
  type: 'object',
  properties: {
    timeframe: {
      type: 'string',
      enum: [
        'day',
        'week',
        'month',
        'year'
      ]
    },
    start: {
      type: 'integer'
    },
    end: {
      type: 'integer'
    },
    isUnrealizedProfitExcluded: {
      type: 'boolean'
    }
  }
}

const paramsSchemaForWinLossVSAccountBalanceApi = {
  type: 'object',
  properties: {
    timeframe: {
      type: 'string',
      enum: [
        'day',
        'week',
        'month',
        'year'
      ]
    },
    start: {
      type: 'integer'
    },
    end: {
      type: 'integer'
    }
  }
}

const paramsSchemaForTradedVolumeApi = {
  type: 'object',
  properties: {
    timeframe: {
      type: 'string',
      enum: [
        'day',
        'week',
        'month',
        'year'
      ]
    },
    start: {
      type: 'integer'
    },
    end: {
      type: 'integer'
    },
    symbol: {
      type: ['string', 'array']
    }
  }
}

const paramsSchemaForTotalFeesReportApi = {
  type: 'object',
  properties: {
    timeframe: {
      type: 'string',
      enum: [
        'day',
        'week',
        'month',
        'year'
      ]
    },
    start: {
      type: 'integer'
    },
    end: {
      type: 'integer'
    },
    symbol: {
      type: ['string', 'array']
    },
    isTradingFees: {
      type: 'boolean'
    },
    isFundingFees: {
      type: 'boolean'
    }
  }
}

const paramsSchemaForPerformingLoanApi = {
  type: 'object',
  properties: {
    timeframe: {
      type: 'string',
      enum: [
        'day',
        'week',
        'month',
        'year'
      ]
    },
    start: {
      type: 'integer'
    },
    end: {
      type: 'integer'
    },
    symbol: {
      type: ['string', 'array']
    }
  }
}

const paramsSchemaForSummaryByAssetApi = {
  type: 'object',
  properties: {
    end: {
      type: 'integer'
    }
  }
}

const {
  timezone,
  dateFormat
} = { ...paramsSchemaForCsv.properties }

const paramsSchemaForBalanceHistoryCsv = {
  type: 'object',
  properties: {
    ...cloneDeep(paramsSchemaForBalanceHistoryApi.properties),
    timezone,
    dateFormat
  }
}

const paramsSchemaForWinLossCsv = {
  type: 'object',
  properties: {
    ...cloneDeep(paramsSchemaForWinLossApi.properties),
    timezone,
    dateFormat
  }
}

const paramsSchemaForWinLossVSAccountBalanceCsv = {
  type: 'object',
  properties: {
    ...cloneDeep(paramsSchemaForWinLossVSAccountBalanceApi.properties),
    timezone,
    dateFormat
  }
}

const paramsSchemaForPositionsSnapshotCsv = {
  type: 'object',
  properties: {
    end: {
      type: 'integer'
    },
    timezone,
    dateFormat
  }
}

const paramsSchemaForFullSnapshotReportCsv = {
  type: 'object',
  properties: {
    end: {
      type: 'integer'
    },
    timezone,
    dateFormat
  }
}

const paramsSchemaForFullTaxReportCsv = {
  type: 'object',
  properties: {
    ...cloneDeep(paramsSchemaForFullTaxReportApi.properties),
    timezone,
    dateFormat
  }
}

const paramsSchemaForTradedVolumeCsv = {
  type: 'object',
  properties: {
    ...cloneDeep(paramsSchemaForTradedVolumeApi.properties),
    timezone,
    dateFormat
  }
}

const paramsSchemaForTotalFeesReportCsv = {
  type: 'object',
  properties: {
    ...cloneDeep(paramsSchemaForTotalFeesReportApi.properties),
    timezone,
    dateFormat
  }
}

const paramsSchemaForPerformingLoanCsv = {
  type: 'object',
  properties: {
    ...cloneDeep(paramsSchemaForPerformingLoanApi.properties),
    timezone,
    dateFormat
  }
}

const paramsSchemaForCandlesCsv = {
  type: 'object',
  properties: {
    ...cloneDeep(paramsSchemaForCandlesApi.properties),
    timezone,
    dateFormat
  }
}

module.exports = {
  paramsSchemaForEditAllPublicСollsСonfs,
  paramsSchemaForEditPublicСollsСonf,
  paramsSchemaForEditCandlesСonf,
  paramsSchemaForCreateSubAccount,
  paramsSchemaForUpdateSubAccount,
  paramsSchemaForBalanceHistoryApi,
  paramsSchemaForWinLossApi,
  paramsSchemaForWinLossVSAccountBalanceApi,
  paramsSchemaForPositionsSnapshotApi,
  paramsSchemaForFullSnapshotReportApi,
  paramsSchemaForFullTaxReportApi,
  paramsSchemaForTradedVolumeApi,
  paramsSchemaForTotalFeesReportApi,
  paramsSchemaForPerformingLoanApi,
  paramsSchemaForCandlesApi,
  paramsSchemaForSummaryByAssetApi,
  paramsSchemaForBalanceHistoryCsv,
  paramsSchemaForWinLossCsv,
  paramsSchemaForWinLossVSAccountBalanceCsv,
  paramsSchemaForPositionsSnapshotCsv,
  paramsSchemaForFullSnapshotReportCsv,
  paramsSchemaForFullTaxReportCsv,
  paramsSchemaForTradedVolumeCsv,
  paramsSchemaForTotalFeesReportCsv,
  paramsSchemaForPerformingLoanCsv,
  paramsSchemaForCandlesCsv
}
