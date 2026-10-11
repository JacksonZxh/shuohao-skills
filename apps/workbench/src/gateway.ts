export interface GatewayReport {
  status: "unverified";
  calls: "not_implemented";
  configured: boolean;
  verifiedAt: null;
  detail: string;
}

export function describeGateway(input: {
  baseUrl: string;
  accountId: string;
  gatewayId: string;
}): GatewayReport {
  const configured =
    input.baseUrl.trim() !== "" &&
    input.accountId.trim() !== "" &&
    input.gatewayId.trim() !== "";
  return {
    status: "unverified",
    calls: "not_implemented",
    configured,
    verifiedAt: null,
    detail: configured
      ? "配置字段已填写，但没有做过连通验证，也不能当成已经连通。"
      : "网关标识还没有配置。没有真实调用，状态保持未验证。",
  };
}
