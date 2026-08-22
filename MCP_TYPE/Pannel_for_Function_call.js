const FunctionModule = require('./Components/Function');

/**
 * Express middleware/route handler to dynamically call any function from Components/Function.js
 */
async function handleFunctionCall(req, res) {
  const { functionName, args } = req.body;
  
  if (!functionName) {
    return res.status(400).json({ success: false, error: 'functionName is required' });
  }

  if (typeof FunctionModule[functionName] !== 'function') {
    return res.status(400).json({ 
      success: false, 
      error: `Function '${functionName}' is not available or not exported in Components/Function.js` 
    });
  }

  try {
    console.log(`[Dynamic Call] Executing '${functionName}' with args:`, args);
    
    // Call function dynamically with array arguments
    const result = await FunctionModule[functionName](...(args || []));
    
    res.json({ success: true, result });
  } catch (err) {
    console.error(`[Dynamic Call] Error executing function '${functionName}':`, err);
    res.status(500).json({ success: false, error: err.message || 'Execution error' });
  }
}

module.exports = {
  handleFunctionCall
};
