'use strict'

const TABLES_NAMES = require('./tables-names')

const USER_ID_CONSTRAINT = `\
CONSTRAINT #{tableName}_fk_user_id
  FOREIGN KEY (user_id)
  REFERENCES ${TABLES_NAMES.USERS}(_id)
  ON UPDATE CASCADE
  ON DELETE CASCADE`
const SUB_USER_ID_CONSTRAINT = `\
CONSTRAINT #{tableName}_fk_subUserId
  FOREIGN KEY (subUserId)
  REFERENCES ${TABLES_NAMES.USERS}(_id)
  ON UPDATE CASCADE
  ON DELETE CASCADE`

module.exports = {
  USER_ID_CONSTRAINT,
  SUB_USER_ID_CONSTRAINT
}
