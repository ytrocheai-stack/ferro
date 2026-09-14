export function nutritionDateForMode(selectedDate: string, todayDate: string, followsToday: boolean): string {
  return followsToday ? todayDate : selectedDate
}
