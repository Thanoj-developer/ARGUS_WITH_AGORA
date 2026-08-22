// HITL-enabled AutoNavigation — supports OTP/human_prompt/option_select_prompt callbacks

/**
 * Run one step of auto-navigation.
 * @param {string} query - The user goal
 * @param {object} hitlCallbacks - Optional callbacks:
 *   onOtpPrompt(action) => Promise<string>          (returns OTP value)
 *   onHumanPrompt(action) => Promise<string>         (returns user input)
 *   onOptionSelect(action) => Promise<number>        (returns selected index)
 * @returns step result object
 */
async function runAutoNavigationStep(query, hitlCallbacks = {}) {
  console.log(`[AutoNavigation Step] Querying next action for: "${query}"`);
  try {
    // Call Port 2002's auto-navigate-query endpoint
    const response = await fetch('http://localhost:2002/api/auto-navigate-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query })
    });
    
    const result = await response.json();
    if (!result.success || !result.action) {
      throw new Error(result.error || 'Failed to retrieve model action.');
    }

    console.log(`[AutoNavigation Step] Action resolved: ${result.action}`);
    let actionData;
    try {
      actionData = JSON.parse(result.action);
    } catch (parseErr) {
      console.warn(`[AutoNavigation Step] Action is not valid JSON, treating as explanation text: "${result.action}"`);
      return { success: true, status: 'halted', reason: result.action };
    }

    let actionsList = [];
    if (actionData.actions && Array.isArray(actionData.actions)) {
      actionsList = actionData.actions;
    } else if (actionData.action) {
      actionsList = [actionData];
    }

    const doneAction = actionsList.find(a => a.action === 'done');
    if (doneAction) {
      console.log(`[AutoNavigation Step] Done action detected: ${doneAction.reason}`);
      return { success: true, status: 'completed', reason: doneAction.reason };
    }

    const noneAction = actionsList.find(a => a.action === 'none');
    if (noneAction) {
      console.log(`[AutoNavigation Step] None action detected: ${noneAction.reason}`);
      return { success: true, status: 'halted', reason: noneAction.reason };
    }

    // --- HITL: OTP / Human Prompt ---
    const otpAction = actionsList.find(a => a.action === 'otp_prompt');
    const humanAction = actionsList.find(a => a.action === 'human_prompt');
    const optionAction = actionsList.find(a => a.action === 'option_select_prompt');

    if (otpAction || humanAction) {
      const targetAction = otpAction || humanAction;
      const isOtp = !!otpAction;
      const label = isOtp ? 'OTP Verification Code' : targetAction.name;
      console.log(`[AutoNavigation HITL] ${isOtp ? 'OTP' : 'Human'} input required for: "${label}"`);

      let userValue = null;
      if (isOtp && hitlCallbacks.onOtpPrompt) {
        userValue = await hitlCallbacks.onOtpPrompt(targetAction);
      } else if (!isOtp && hitlCallbacks.onHumanPrompt) {
        userValue = await hitlCallbacks.onHumanPrompt(targetAction);
      }

      if (!userValue || String(userValue).trim() === '') {
        return { success: false, error: 'HITL: User cancelled OTP/human input.' };
      }

      const rawVal = String(userValue).trim();
      const numericValue = /^\d+$/.test(rawVal) ? parseInt(rawVal, 10) : rawVal;
      actionData = { index: targetAction.index, value: numericValue };
    } else if (optionAction) {
      console.log(`[AutoNavigation HITL] Option selection required`);
      let selectedIndex = null;
      if (hitlCallbacks.onOptionSelect) {
        selectedIndex = await hitlCallbacks.onOptionSelect(optionAction);
      }
      if (selectedIndex === null || selectedIndex === undefined) {
        return { success: false, error: 'HITL: User cancelled option selection.' };
      }
      actionData = { index: selectedIndex, action: 'click' };
    }

    // Execute action on Port 2002
    console.log(`[AutoNavigation Step] Executing action: ${JSON.stringify(actionData)}`);
    const runResponse = await fetch('http://localhost:2002/api/dom-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'runClickOrFill',
        params: actionData
      })
    });
    
    const runResult = await runResponse.json();
    if (!runResult.success) {
      throw new Error(runResult.error || 'Failed to execute DOM action');
    }

    return { success: true, status: 'step_executed', action: actionData, message: runResult.result?.message };
  } catch (error) {
    console.error('[AutoNavigation Step] Error during step execution:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Run the full auto-navigation loop.
 * @param {string} query - The user goal
 * @param {object} hitlCallbacks - HITL callbacks (see runAutoNavigationStep)
 * @param {function} onStepLog - Optional: called after each step with step info
 */
async function runAutoNavigationLoop(query, hitlCallbacks = {}, onStepLog = null) {
  console.log(`[AutoNavigation Loop] Starting loop for query: "${query}"`);
  let stepsLog = [];
  let done = false;
  let stepsCount = 0;

  while (!done && stepsCount < 20) {
    stepsCount++;
    console.log(`[AutoNavigation Loop] Executing step ${stepsCount}`);
    
    const result = await runAutoNavigationStep(query, hitlCallbacks);
    const logEntry = { step: stepsCount, ...result };
    stepsLog.push(logEntry);

    if (onStepLog) onStepLog(logEntry);

    if (!result.success) {
      done = true;
      break;
    }

    if (result.status === 'completed' || result.status === 'halted') {
      done = true;
      break;
    }

    // Wait 2.5 seconds to stabilize
    await new Promise(resolve => setTimeout(resolve, 2500));
  }

  return { success: true, status: stepsLog[stepsLog.length - 1]?.status || 'unknown', log: stepsLog };
}

module.exports = { runAutoNavigationLoop, runAutoNavigationStep };
