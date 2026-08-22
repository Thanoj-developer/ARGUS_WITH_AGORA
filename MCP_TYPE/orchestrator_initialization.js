const fs = require('fs');
const path = require('path');

class OrchestratorInitialization {
  constructor() {
    this.originalTask = '';    // Stores the search query from the AUTO NAVIGATION control panel
    this.history = [];         // Stores history of executed actions/steps
    this.terminalJson = null;  // Stores last state of terminal execution JSON
    this.selectorMap = {};     // Map of index to element selectors/roles/names
  }

  /**
   * Initializes the session with a new user goal.
   * @param {string} query - The initial search query goal.
   */
  initialize(query) {
    this.originalTask = query;
    this.history = [];
    this.terminalJson = null;
    this.selectorMap = {};
    console.log(`[Orchestrator] Session initialized. Goal: "${query}"`);
  }

  /**
   * Stores the latest AXTree selector map to resolve step targets during execution.
   */
  setSelectorMap(map) {
    this.selectorMap = map || {};
  }

  /**
   * Records a new action step into the history.
   * @param {Object} actionObj - The action payload ({ index, action, value }).
   * @param {string} pageTitle - The title of the page where the action occurred.
   */
  addStep(actionObj, pageTitle = '') {
    const index = actionObj.index;
    let name = actionObj.name || '';
    let role = actionObj.role || '';

    // Resolve name and role if index is provided and exists in the current selector map
    if (index !== undefined && this.selectorMap[index]) {
      name = this.selectorMap[index].name || name;
      role = this.selectorMap[index].role || role;
    }

    let action = actionObj.action;
    if (!action) {
      const roleLower = role.toLowerCase();
      if (roleLower === 'textbox' || roleLower === 'searchbox') {
        action = 'fill';
      } else if (roleLower === 'combobox' || roleLower === 'listbox') {
        action = 'select';
      } else {
        action = actionObj.value !== undefined ? 'fill' : 'click';
      }
    }

    const step = {
      action: action,
      index: index,
      value: actionObj.value !== undefined ? actionObj.value : '',
      name: name,
      role: role,
      pageTitle: pageTitle,
      timestamp: new Date().toLocaleTimeString()
    };

    this.history.push(step);
    this.terminalJson = actionObj; // Keep terminalJson updated with the latest action state
    console.log(`[Orchestrator] Added step: ${JSON.stringify(step)}`);
  }

  /**
   * Updates the terminal execution JSON state directly.
   * @param {Object} json - The current terminal execution JSON.
   */
  setTerminalJson(json) {
    this.terminalJson = json;
  }

  /**
   * Retrieves the current session state object.
   */
  getState() {
    return {
      originalTask: this.originalTask,
      history: this.history,
      terminalJson: this.terminalJson
    };
  }

  /**
   * Formats the execution history for the LLM prompt context.
   */
  getFormattedHistory() {
    if (this.history.length === 0) {
      return 'No steps executed yet.';
    }
    return this.history.map((step, idx) => {
      const pageStr = step.pageTitle ? ` on page "${step.pageTitle}"` : '';
      let desc = '';
      if (step.action === 'click') {
        desc = `Clicked element "${step.name}" (${step.role}) at index ${step.index}`;
      } else if (step.action === 'fill') {
        desc = `Filled value "${step.value}" into "${step.name}" (${step.role}) at index ${step.index}`;
      } else {
        desc = `Executed ${step.action} on index ${step.index}`;
      }
      return `Step ${idx + 1}${pageStr}: ${desc}`;
    }).join('\n');
  }
}

// Export a singleton instance so state is shared across imports
module.exports = new OrchestratorInitialization();
