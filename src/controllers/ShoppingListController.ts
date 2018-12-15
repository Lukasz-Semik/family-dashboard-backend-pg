import {
  JsonController,
  UseBefore,
  Authorized,
  Get,
  Post,
  Patch,
  Delete,
  Req,
  Res,
} from 'routing-controllers';
import { getRepository } from 'typeorm';
import { isEmpty } from 'lodash';

import { RES_INTERNAL_ERROR } from '../constants/resStatuses';
import { RES_BAD_REQUEST } from '../constants/resStatuses';
import { internalServerErrors, defaultErrors } from '../constants/errors';
import urlencodedParser, { jsonParser } from '../utils/bodyParser';
import { validateUserPermissions } from '../validators/user';
import { API_SHOPPING_LISTS } from '../constants/routes';
import { shoppingListsSuccesses } from '../constants/successes';
import { User, Family, ShoppingList } from '../entity';
import { Token } from '.';

interface ShoppingListTypes {
  title: string;
  deadline?: string;
  upcomingItems: string[];
  doneItems: string[];
}

@JsonController()
export class ShoppingListController {
  userRepository = getRepository(User);
  familyRepository = getRepository(Family);
  shoppingListRepository = getRepository(ShoppingList);

  familyWithShoppingListQuery = id =>
    this.familyRepository
      .createQueryBuilder('family')
      .leftJoinAndSelect('family.shoppingLists', 'shoppingLists')
      .where('family.id = :id', { id })
      // tslint:disable-next-line semicolon
      .getOne();

  getCurrentUser = async req => {
    const { id: idDecoded } = await Token.decode(req.headers.authorization);

    const user = await this.userRepository.findOne({ id: idDecoded }, { relations: ['family'] });

    return user;
    // tslint:disable-next-line semicolon
  };

  // @description: add shopping list
  // @full route: /api/shopping-lists
  // @access: private
  @Post(API_SHOPPING_LISTS)
  @UseBefore(urlencodedParser)
  @UseBefore(jsonParser)
  @Authorized()
  async createShoppingList(@Req() req: any, @Res() res: any) {
    try {
      const { title, deadline, items } = req.body;

      if (isEmpty(title) || isEmpty(items))
        return res.status(RES_BAD_REQUEST).json({ errors: { payload: defaultErrors.isRequired } });

      const user = await this.getCurrentUser(req);

      const { isValid, errors, status } = validateUserPermissions(user, {
        checkIsVerified: true,
        checkHasFamily: true,
      });

      if (!isValid) return res.status(status).json({ errors });

      const upcomingItems: string[] = items.filter(item => !item.isDone).map(item => item.name);

      const doneItems: string[] = items.filter(item => item.isDone).map(item => item.name);

      const family = await this.familyWithShoppingListQuery(user.family.id);

      const newShoppingList = new ShoppingList();

      const shoppingListData: ShoppingListTypes = {
        title,
        upcomingItems,
        doneItems,
      };

      if (!isEmpty(deadline)) shoppingListData.deadline = deadline;

      const shoppingList = await this.shoppingListRepository.save({
        ...newShoppingList,
        ...shoppingListData,
        isDone: false,
      });

      family.shoppingLists.push(shoppingList);

      await this.familyRepository.save(family);

      return res.status(200).json({ shoppinList: shoppingListsSuccesses.shoppingListCreated });
    } catch (err) {
      return res
        .status(RES_INTERNAL_ERROR)
        .json({ error: internalServerErrors.sthWrong, caughtError: err });
    }
  }
}
