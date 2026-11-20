export const health = async () => fetch(process.env.INTERNAL_HEALTH_URL!);
