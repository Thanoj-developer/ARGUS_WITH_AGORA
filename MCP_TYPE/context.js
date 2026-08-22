class NavigationContext {
  constructor() {
    this.goal = '';
    this.steps = []; // array of { action, index, value, name, role, pageTitle }
    this.selectorMap = {};
  }

  /**
   * Resets all history and mapping states.
   */
  clear() {
    this.goal = '';
    this.steps = [];
    this.selectorMap = {};
  }

  /**
   * Sets the target navigation goal. Resets history if goal is new.
   */
  setGoal(goal) {
    if (this.goal !== goal) {
      this.clear();
      this.goal = goal;
    }
  }

  getGoal() {
    return this.goal;
  }

  /**
   * Stores the latest AXTree selector map to resolve step targets during execution.
   */
  setSelectorMap(map) {
    this.selectorMap = map || {};
  }

  /**
   * Records an executed navigation step. Maps selector index to element metadata.
   */
  addStep(actionObj, pageTitle = '') {
    const index = actionObj.index;
    let name = '';
    let role = '';

    if (index !== undefined && this.selectorMap[index]) {
      name = this.selectorMap[index].name || '';
      role = this.selectorMap[index].role || '';
    }

    this.steps.push({
      action: actionObj.action,
      index: index,
      value: actionObj.value,
      name: name,
      role: role,
      pageTitle: pageTitle
    });
  }

  getSteps() {
    return this.steps;
  }

  /**
   * Returns a human-readable list of already executed steps.
   */
  getFormattedHistory() {
    if (this.steps.length === 0) {
      return "No actions have been executed yet in this session.";
    }
    return this.steps.map((step, idx) => {
      const pageStr = step.pageTitle ? ` on page "${step.pageTitle}"` : '';
      let actionStr = '';
      if (step.action === 'click') {
        actionStr = `Clicked on "${step.name}" (${step.role}) at index ${step.index}`;
      } else if (step.action === 'fill') {
        actionStr = `Filled value "${step.value}" into "${step.name}" (${step.role}) at index ${step.index}`;
      } else {
        actionStr = `Executed action "${step.action}" at index ${step.index || 'N/A'}`;
      }
      return `Step ${idx + 1}${pageStr}: ${actionStr}`;
    }).join('\n');
  }
}

module.exports = new NavigationContext();
