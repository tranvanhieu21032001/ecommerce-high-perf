export const ORDER_CREATED_QUEUE = 'orders.created';

export type OrderCreatedEvent = {
  orderId: string;
  orderNumber: string;
  userEmail: string;
  totalAmount: number;
  itemCount: number;
};
