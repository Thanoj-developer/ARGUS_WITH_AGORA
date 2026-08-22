// Using native global fetch

async function runOrchestrator(query) {
  console.log(`[Orchestrator Agent] Running backend API orchestration logic for query: "${query}"`);
  try {
    const response = await fetch('http://localhost:2002/api/orchestrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: query,
        history: [],
        selectedSheets: [],
        selectedJsonFiles: [],
        maxTabs: 999
      })
    });
    
    const data = await response.json();
    if (!data.success || !data.reply) {
      throw new Error(data.error || 'Failed to get orchestrator response');
    }

    const reply = data.reply.trim();
    let executedSteps = [];

    if (reply.startsWith('CALL:')) {
      const jsonStr = reply.substring(5).trim();
      const steps = JSON.parse(jsonStr);
      if (Array.isArray(steps) && steps.length > 0) {
        console.log(`[Orchestrator Agent] Executing ${steps.length} sequential steps...`);
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          console.log(`[Orchestrator Agent] Executing step ${i + 1}/${steps.length}: ${step.func}(${JSON.stringify(step.args)})`);
          
          let runResponse = await fetch('http://localhost:2002/api/call-function', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              functionName: step.func,
              args: step.args
            })
          });
          let runResult = await runResponse.json();
          if (runResult.success) {
            let message = 'Success';
            
            // If the function was runAiMode, we execute the generated code
            if (step.func === 'runAiMode' && typeof runResult.result === 'string') {
              console.log(`[Orchestrator Agent] runAiMode generated code. Executing it...`);
              const execResponse = await fetch('http://localhost:2002/api/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  code: runResult.result
                })
              });
              const execResult = await execResponse.json();
              if (execResult.success) {
                message = 'Code executed successfully: ' + (execResult.result || '');
              } else {
                throw new Error(execResult.error || 'Failed to execute generated code');
              }
            } else if (runResult.result && runResult.result.message) {
              message = runResult.result.message;
            }
            
            executedSteps.push({ step, success: true, message });
          } else {
            executedSteps.push({ step, success: false, error: runResult.error || 'Failed' });
            throw new Error(`Step failed: ${runResult.error}`);
          }
          // Delay to stabilize browser
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    }

    return { success: true, reply, executedSteps };
  } catch (error) {
    console.error('[Orchestrator Agent] Error:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { runOrchestrator };
