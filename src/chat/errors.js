const { BizError } = require('../utils/response');

function chatError(code, message, httpStatus = 400) {
  const error = new BizError(message, { code, httpStatus });
  error.chatCode = code;
  return error;
}

module.exports = { chatError };
