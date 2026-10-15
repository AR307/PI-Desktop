import { Type } from "typebox";

export const IMAGE_TOOL_DESCRIPTIONS: Record<string, string> = {
  ListImageModels: "List the signed-in MirrorCoding account's available image models, groups, actual billing multipliers and supported parameters, plus image references in this session. Query before generating; choose the model and group yourself to satisfy the user. Listing is allowed while planning.",
  GenerateImage: "Generate images with an explicit modelId and providerId from ListImageModels. Use only declared parameters. referenceIds may name current user attachments or historical images the user explicitly asked to use; never silently add history. The result is displayed as image cards, even for text-only chat models. This does not change the user's manual image model selection. Do not retry automatically when cancelled or the result is uncertain.",
};
export const IMAGE_TOOL_PARAMETERS = {
  ListImageModels: {},
  GenerateImage: {
    providerId: Type.String(), modelId: Type.String(), prompt: Type.String(),
    referenceIds: Type.Optional(Type.Array(Type.String())),
    options: Type.Optional(Type.Object({
      size: Type.Optional(Type.String()), quality: Type.Optional(Type.String()),
      aspectRatio: Type.Optional(Type.String()), count: Type.Optional(Type.Integer({ minimum: 1 })),
    })),
  },
};
