import { bitable, UIBuilder, FieldType } from "@lark-base-open/js-sdk";
import { UseTranslationResponse } from 'react-i18next';

const table = await bitable.base.getActiveTable();

export default async function main(uiBuilder: UIBuilder, { t }: UseTranslationResponse<'translation', undefined>) {
  uiBuilder.form(form => ({
    formItems: [
      form.tableSelect('table', { label: `${t('Select data table')}` }),
      form.viewSelect('view', { label: `${t('Select view')}`, sourceTable: 'table' }),
      form.fieldSelect('payerField', { label: `${t('Select field for payer')}`, sourceTable: 'table', multiple: false }),
      form.fieldSelect('amountField', { label: `${t('Select field for amount')}`, sourceTable: 'table', multiple: false }),
      form.select('modeSelect', { label: `${t('Select the way to show results')}`, options: [{ label: `${t('Only Text')}`, value: 'Text' }, { label: `${t('Text + new field in table')}`, value: 'Table' }], defaultValue: 'Text' }),
    ],
    buttons: [`${t('Submit')}`],
  }), async ({ values }) => {
    const { table, view, payerField, amountField, modeSelect } = values;
    /** 
       基于借贷记账法，实现分账功能；保持每次支付都是由一个人单独支付，但是通过互相转账，实现每个人都支付了相同的金额   
    */
    const recordIdList = await view.getVisibleRecordIdList();
    // 支付记录 payer:amount
    let transactionMap = {}
    // 遍历，并更新支付记录
    for (let i = 0; i < recordIdList.length; i++) {
      const payerValue = await payerField.getValue(recordIdList[i]);
      const amountValue = await amountField.getValue(recordIdList[i]);
      if (isNullOrUndefined(payerValue) || isNullOrUndefined(amountValue)) {
        continue;
      }
      // 付款人 支持 文本字段 || 人员字段
      const payer = payerValue[0].text || payerValue[0].name
      // 金额 支持 货币字段 || 数字字段
      const amount = amountValue;
      transactionMap[payer] = (transactionMap[payer] || 0) + amount;
    }
    // 生成transactions transactions = [{ payer: "PersonA", amount: 30, participants: ["PersonA", "PersonB", "PersonC"] },...]
    const transactions = Object.keys(transactionMap).map(payer => {
      return {
        payer,
        amount: transactionMap[payer],
        participants: Object.keys(transactionMap)
      }
    })
    const results = splitExpenses(transactions);
    // text输出结果
    results.forEach(result => { uiBuilder.text(`${result[0]} ${t('pay')} ${result[2]} ${t('for')} ${result[1]}`) });
    // 表格中新增字段，处理结果
    const tableFlag = modeSelect == 'Table';
    if (tableFlag) {
      let field0, field1, field2;
      try {
        field0 = await table.getFieldByName<ITextField>(`${t('Split Result-Payer')}`);
      } catch (e) {
        // 不存在则创建
        const fieldId0 = await table.addField({ type: FieldType.Text, name: `${t('Split Result-Payer')}` });
        field0 = await table.getField<ITextField>(fieldId0);
      }
      try {
        field1 = await table.getFieldByName<ITextField>(`${t('Split Result-Payee')}`);
      } catch (e) {
        // 不存在则创建
        const fieldId1 = await table.addField({ type: FieldType.Text, name: `${t('Split Result-Payee')}` });
        field1 = await table.getField<ITextField>(fieldId1);
      }
      try {
        field2 = await table.getFieldByName<ITextField>(`${t('Split Result-Amount')}`);
      } catch (e) {
        // 不存在则创建
        const fieldId2 = await table.addField({ type: FieldType.Text, name: `${t('Split Result-Amount')}` });
        field2 = await table.getField<INumberField>(fieldId2);
      }
      for (let i = 0; i < results.length; i++) {
        // visibleRecordList 理论上 >= results.length
        await field0.setValue(recordIdList[i], results[i][0]);
        await field1.setValue(recordIdList[i], results[i][1]);
        await field2.setValue(recordIdList[i], results[i][2]);
      }
    }
  });
}


function isNullOrUndefined(value: any): boolean {
  return value === null || value === undefined;
}



function splitExpenses(transactions) {
  // transactions是一个包含每次支付信息的数组，每个元素是一个对象，包含payer（支付者）、amount（支付金额）、participants（参与者数组）
  let results = [];
  // 创建一个对象来跟踪每个人的余额
  let balances = {};
  // 计算每个人的余额
  transactions.forEach(transaction => {
    // 支付者扣除支付金额
    balances[transaction.payer] = (balances[transaction.payer] || 0) - transaction.amount;
    // 参与者每人增加平均支付金额
    let perParticipantAmount = transaction.amount / transaction.participants.length;
    transaction.participants.forEach(participant => {
      balances[participant] = (balances[participant] || 0) + perParticipantAmount;
    });
  });
  // 找到余额最大的人和最小的人
  let maxBalancePerson = Object.keys(balances).reduce((a, b) => balances[a] > balances[b] ? a : b);
  let minBalancePerson = Object.keys(balances).reduce((a, b) => balances[a] < balances[b] ? a : b);
  // 将最大余额的人付款给最小余额的人，直到两者之一的余额接近零
  while (balances[maxBalancePerson] > 0.01 || balances[minBalancePerson] < -0.01) {
    let amountToTransfer = Math.min(Math.abs(balances[maxBalancePerson]), Math.abs(balances[minBalancePerson]));
    // 更新余额
    balances[maxBalancePerson] -= amountToTransfer;
    balances[minBalancePerson] += amountToTransfer;
    // 记录每次的转账情况
    results.push([maxBalancePerson, minBalancePerson, amountToTransfer.toFixed(2)]);
    // 重新计算最大和最小余额的人
    maxBalancePerson = Object.keys(balances).reduce((a, b) => balances[a] > balances[b] ? a : b);
    minBalancePerson = Object.keys(balances).reduce((a, b) => balances[a] < balances[b] ? a : b);
  }
  return results;
}


