// 工具风险分级表。学自 grok-build 的穷尽匹配（conversation.rs:186 starts_prompt_turn）：
// 新增工具必须在此登记，否则启动时 assertAllToolsClassified 直接失败——
// 避免新写操作工具漏配 requiresConfirmation 而静默执行。
//
// - 'read'    : 只读，无副作用 → 并行、不需确认
// - 'write'   : 有副作用但可撤销/低风险 → 串行、不需确认
// - 'confirm' : 不可逆或对外可见 → 串行、必须用户确认

const TOOL_RISK = {
  get_my_profile: 'read',
  list_jobs: 'read',
  get_job_detail: 'read',
  recommend_jobs: 'read',
  list_my_favorites: 'read',
  list_my_applications: 'read',
  favorite_job: 'write',
  apply_job: 'confirm',
};

/**
 * 启动时校验：注册的工具与风险表必须一一对应。
 * 漏登记或登记了已不存在的工具都报错，fail fast at startup。
 * 在 app.js 启动时调用。
 */
function assertAllToolsClassified(toolNames) {
  const unclassified = toolNames.filter((n) => !(n in TOOL_RISK));
  if (unclassified.length) {
    throw new Error(
      `以下工具未在 safetyPolicy.TOOL_RISK 中登记风险等级：${unclassified.join(', ')}\n`
      + '新增工具时必须显式决定它的风险等级（read / write / confirm）。',
    );
  }
  const stale = Object.keys(TOOL_RISK).filter((n) => !toolNames.includes(n));
  if (stale.length) {
    throw new Error(`safetyPolicy.TOOL_RISK 中有已不存在的工具：${stale.join(', ')}`);
  }
}

function requiresConfirmation(toolName) {
  return TOOL_RISK[toolName] === 'confirm';
}

function getRisk(toolName) {
  return TOOL_RISK[toolName] ?? null;
}

/**
 * 工具执行模式：read → parallel（并发），write/confirm → sequential（串行）。
 * runner 用它决定是否整批降级串行（任一 sequential 则整批串行）。
 */
function getExecutionMode(toolName) {
  return TOOL_RISK[toolName] === 'read' ? 'parallel' : 'sequential';
}

module.exports = {
  TOOL_RISK,
  assertAllToolsClassified,
  requiresConfirmation,
  getRisk,
  getExecutionMode,
};
