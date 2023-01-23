export interface OrderRequest {
    material: string;
    type: 'Buy' | 'Sell';
    quantity: number;
    pricePerUnit: number;
}

export interface OrderDynamoItem extends OrderRequest {
    sk: string;
}
