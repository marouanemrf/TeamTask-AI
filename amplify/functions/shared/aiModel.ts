import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

/**
 * Bedrock access for the data-stack functions (planning, weekly report). The model id comes from
 * the deployment (ASSISTANT_MODEL_ID, same model as the assistant). The guardrail lives in the
 * assistant stack, which depends on the data stack: its "id:version" is read at run time from the
 * SSM parameter that stack writes (a CloudFormation reference would make the stacks depend on each
 * other). Without the parameter, calls run without the guardrail and say so in the logs.
 */
const bedrock = new BedrockRuntimeClient({});
const ssm = new SSMClient({});
let guardrailCache: Promise<{ guardrailIdentifier: string; guardrailVersion: string } | null> | null = null;

function guardrail() {
  guardrailCache ??= (async () => {
    const name = process.env.GUARDRAIL_PARAMETER;
    if (!name) return null;
    try {
      const value = (await ssm.send(new GetParameterCommand({ Name: name }))).Parameter?.Value ?? "";
      const [guardrailIdentifier, guardrailVersion] = value.split(":");
      return guardrailIdentifier && guardrailVersion ? { guardrailIdentifier, guardrailVersion } : null;
    } catch (error) {
      console.warn(JSON.stringify({ fn: "aiModel", warning: "guardrail parameter unavailable", error: error instanceof Error ? error.name : String(error) }));
      return null;
    }
  })();
  return guardrailCache;
}

export interface ModelAnswer {
  text: string;
  /** "guardrail_intervened" when the guardrail blocked the input or the output. */
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  modelId: string;
}

export async function askModel(system: string, prompt: string, maxTokens: number, temperature = 0.2): Promise<ModelAnswer> {
  const modelId = process.env.MODEL_ID;
  if (!modelId) throw new Error("MODEL_ID is not configured");
  const guard = await guardrail();
  const result = await bedrock.send(new ConverseCommand({
    modelId,
    system: [{ text: system }],
    messages: [{ role: "user", content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens, temperature },
    ...(guard ? { guardrailConfig: guard } : {}),
  }));
  return {
    text: (result.output?.message?.content ?? []).map((c) => c.text ?? "").join(""),
    stopReason: result.stopReason,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    modelId,
  };
}
